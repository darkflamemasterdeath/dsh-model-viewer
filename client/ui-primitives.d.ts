declare module '@deepseek-ai/dsh-client-ui-primitives' {
    import type { ButtonHTMLAttributes, ReactNode } from 'react'
  
    export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
      variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
      size?: 'md' | 'sm'
      icon?: ReactNode
    }
  
    export const Button: import('react').ForwardRefExoticComponent<
      ButtonProps & import('react').RefAttributes<HTMLButtonElement>
    >
  
    export function Checkbox(props: {
      checked: boolean
      onChange: (next: boolean) => void
      label: string
    }): import('react').JSX.Element
  }