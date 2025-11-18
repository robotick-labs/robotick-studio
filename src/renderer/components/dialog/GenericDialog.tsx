import React from "react";
import styles from "./styles/generic-dialog.module.css";

export type DialogAction = {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
};

interface GenericDialogProps {
  title: string;
  message?: React.ReactNode;
  onClose: () => void;
  actions?: DialogAction[];
  error?: string | null;
}

export function GenericDialog({
  title,
  message,
  onClose,
  actions = [],
  error,
}: GenericDialogProps) {
  return (
    <div className={styles.backdrop}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        <button
          type="button"
          className={styles.closeButton}
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
        <h3>{title}</h3>
        {message ? <div className={styles.message}>{message}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        {actions.length > 0 ? (
          <div className={styles.actions}>
            {actions.map((action, index) => (
              <button
                key={`${action.label}-${index}`}
                type="button"
                className={
                  action.variant === "primary"
                    ? styles.primary
                    : styles.secondary
                }
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
