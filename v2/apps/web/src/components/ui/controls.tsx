/**
 * U1 — kontrole. Ekrani ne koriste sirove <input>/<select>/<textarea>/<button> (lint U3);
 * sve ide kroz ove komponente, a izgled živi u gx-* klasama (shell.css), na jednom mjestu.
 * Field povezuje labelu, pomoć i grešku preko id/aria — isto ponašanje na svakom ekranu.
 */
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useId } from "react";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="gx-field">
      <label className="gx-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error ? <p className="gx-field__hint">{hint}</p> : null}
      {error ? (
        <p className="gx-field__hint" role="alert" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; label?: string; hint?: string; error?: string };

export function Input({ invalid, id, label, hint, error, ...props }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const field = <input id={inputId} className="gx-input" aria-invalid={invalid || error ? true : undefined} aria-describedby={hint || error ? `${inputId}-hint` : undefined} {...props} />;
  if (!label) return field;
  return (
    <Field label={label} htmlFor={inputId} hint={hint} error={error}>
      {field}
    </Field>
  );
}

export function Select({ id, label, hint, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string }) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const field = (
    <select id={selectId} className="gx-input" {...props}>
      {children}
    </select>
  );
  if (!label) return field;
  return (
    <Field label={label} htmlFor={selectId} hint={hint}>
      {field}
    </Field>
  );
}

export function Textarea({ id, label, hint, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string }) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const field = <textarea id={areaId} className="gx-input" {...props} />;
  if (!label) return field;
  return (
    <Field label={label} htmlFor={areaId} hint={hint}>
      {field}
    </Field>
  );
}

export function Checkbox({
  label,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="gx-check">
      <input id={inputId} type="checkbox" {...props} />
      <label htmlFor={inputId}>{label}</label>
    </div>
  );
}
