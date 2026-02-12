import { forwardRef, cloneElement, isValidElement } from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  asChild?: boolean;
  children: React.ReactNode;
}

const base =
  'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-brand-blue disabled:opacity-50 disabled:pointer-events-none';

const variants = {
  primary:
    'bg-brand-orange text-white hover:bg-brand-orange/90 focus:ring-brand-orange dark:bg-brand-orange dark:hover:bg-brand-orange/90',
  secondary:
    'bg-brand-blue text-white hover:bg-brand-blue/90 focus:ring-brand-blue dark:bg-brand-blue dark:hover:bg-brand-blue/90',
  outline:
    'border-2 border-brand-blue text-brand-blue hover:bg-brand-blue/5 dark:border-brand-orange dark:text-brand-orange dark:hover:bg-brand-orange/10 focus:ring-brand-blue dark:focus:ring-brand-orange',
  ghost:
    'text-brand-blue hover:bg-brand-blue/5 dark:text-brand-orange dark:hover:bg-brand-orange/10 focus:ring-brand-gray',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', asChild, className = '', children, ...props }, ref) => {
    const classes = `${base} ${variants[variant]} ${sizes[size]} ${className}`.trim();

    if (asChild && isValidElement(children)) {
      return cloneElement(children as React.ReactElement<{ className?: string }>, {
        className: [classes, (children.props as { className?: string }).className].filter(Boolean).join(' '),
      });
    }

    return (
      <button ref={ref} className={classes} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
