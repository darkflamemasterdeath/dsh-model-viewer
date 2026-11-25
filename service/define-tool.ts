/**
 * Local `defineTool` — a pure re-implementation of the builder exported by
 * `@deepseek-ai/dsh-tools`.
 *
 * A profile plugin must not import the host packages at runtime: their module
 * graph pulls in host-only peers (`@deepseek-ai/dsh-llm` and friends) that do
 * not resolve from the profile tree, and hoisting a copy into the profile
 * shadows the host's own `tools` row. Published plugins therefore keep
 * `@deepseek-ai/*` type-only and receive runtime capabilities through `ctx`.
 * This file inlines the builder's pure parts — spec compilation and definition
 * assembly — so the host entry keeps zero runtime host-package imports.
 *
 * Scope: the flat primitive property specs (`string`/`number`/`boolean`) and
 * the object-rooted output schema this plugin declares. Nested schemas are out
 * of scope.
 */
import type {
  DefineToolOptions,
  ObjectValueSchemaSpec,
  ParameterSchemaSpec,
  ToolDefinition,
  ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'

/** Compiled object-rooted JSON Schema. */
interface CompiledSchema {
  type: 'object'
  additionalProperties?: boolean
  properties: Record<string, unknown>
  required?: string[]
}

/** Flat view of one property spec used by the compiler. */
interface FlatPropertySpec {
  type?: string
  description?: string
  required?: true
}

/**
 * Compile a per-property spec (with inline `required`) into standard JSON Schema.
 * @param properties - property specs keyed by name.
 * @param additionalProperties - openness flag carried over for output roots.
 * @returns an object-rooted JSON Schema as a loose record.
 */
function compileObjectSchema(properties: ParameterSchemaSpec, additionalProperties?: boolean): CompiledSchema {
  const compiled: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, spec] of Object.entries(properties)) {
    const flat = spec as FlatPropertySpec
    compiled[key] = { type: flat.type, ...(flat.description === undefined ? {} : { description: flat.description }) }
    if (flat.required === true) required.push(key)
  }
  return {
    type: 'object',
    ...(additionalProperties === undefined ? {} : { additionalProperties }),
    properties: compiled,
    ...(required.length === 0 ? {} : { required }),
  }
}

/**
 * Narrow a value schema to its object root.
 * @param spec - any author-facing value schema.
 * @returns the object variant of the spec.
 */
function asObjectSpec(spec: ValueSchemaSpec): ObjectValueSchemaSpec {
  if ((spec as { type?: string }).type !== 'object') {
    throw new Error('defineTool: only object-rooted output schemas are supported')
  }
  return spec as ObjectValueSchemaSpec
}

/**
 * Validate arguments against the compiled parameter schema.
 * @param schema - compiled object schema.
 * @param args - candidate arguments, however malformed.
 * @returns path-qualified violations; empty means valid.
 */
function validateArguments(schema: CompiledSchema, args: unknown): string[] {
  if (typeof args !== 'object' || args === null) return ['<root>: expected object']
  const record = args as Record<string, unknown>
  const violations: string[] = []
  for (const key of schema.required ?? []) {
    if (record[key] === undefined) violations.push(`${key}: required`)
  }
  for (const [key, raw] of Object.entries(schema.properties)) {
    const value = record[key]
    if (value === undefined) continue
    const type = (raw as { type?: string }).type
    if (type === 'string' && typeof value !== 'string') violations.push(`${key}: expected string`)
    if (type === 'number' && typeof value !== 'number') violations.push(`${key}: expected number`)
    if (type === 'boolean' && typeof value !== 'boolean') violations.push(`${key}: expected boolean`)
  }
  return violations
}

/**
 * Define a tool with inferred arguments and strict execution validation.
 * @param options - tool name, description, parameter/output specs, and handlers.
 * @returns a registry-ready tool definition.
 */
export function defineTool<S extends ParameterSchemaSpec, O extends ValueSchemaSpec>(
  options: DefineToolOptions<S, O>,
): ToolDefinition {
  // Handler signatures derived from the caller's options keep the lambdas below
  // fully typed without naming the host's inference helpers.
  type ToolArgs = Parameters<typeof options.execute>[0]
  type ToolValue = Parameters<typeof options.output.render>[1]
  type ToolExec = Parameters<typeof options.execute>[1]
  const parameters = compileObjectSchema(options.parameters)
  const outputSchema = compileObjectSchema(
    asObjectSpec(options.output.schema).properties ?? {},
    asObjectSpec(options.output.schema).additionalProperties,
  )
  const presentationMeta = options.output.presentationMeta
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: outputSchema,
      render: (args: ToolArgs, value: ToolValue) => options.output.render(args, value),
      ...(presentationMeta === undefined
        ? {}
        : { presentationMeta: (args: ToolArgs, value: ToolValue) => presentationMeta(args, value) }),
    },
    async execute(args: ToolArgs, exec: ToolExec) {
      const violations = validateArguments(parameters, args)
      if (violations.length > 0) throw new Error(`invalid arguments: ${violations.join('; ')}`)
      return options.execute(args, exec)
    },
  } as unknown as ToolDefinition
}
