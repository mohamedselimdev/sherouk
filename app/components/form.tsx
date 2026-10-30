import { btnPrimary } from "./ui";

export const inputCls = "mt-1 w-full rounded-input border border-sand bg-surface px-3 py-2.5 text-sm text-fg";

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required = true,
  defaultValue,
  hint,
  dir,
  inputMode,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
  dir?: "ltr" | "rtl";
  inputMode?: "numeric" | "decimal" | "text" | "email";
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        dir={dir}
        inputMode={inputMode}
        className={inputCls}
      />
      {hint ? <span className="mt-1 block text-xs font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

export function FormError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-input border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300"
    >
      {children}
    </p>
  );
}

export function FormOk({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="status"
      className="rounded-input border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300"
    >
      {children}
    </p>
  );
}

export function SubmitButton({
  children,
  className = btnPrimary,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button type="submit" className={className}>
      {children}
    </button>
  );
}
