export function isTouchCapable(
  navigatorLike?: Pick<Navigator, 'maxTouchPoints'>,
): boolean {
  return (navigatorLike?.maxTouchPoints ?? 0) > 0;
}

interface NativeInputSnapshot {
  disabled: boolean;
  readOnly: boolean;
  inputMode: string;
  tabIndexAttribute: string | null;
}

const snapshots = new WeakMap<HTMLTextAreaElement, NativeInputSnapshot>();

export function setNativeInputDisabled(
  textarea: HTMLTextAreaElement,
  disabled: boolean,
): void {
  if (disabled) {
    if (!snapshots.has(textarea)) {
      snapshots.set(textarea, {
        disabled: textarea.disabled,
        readOnly: textarea.readOnly,
        inputMode: textarea.inputMode,
        tabIndexAttribute: textarea.getAttribute('tabindex'),
      });
    }
    textarea.disabled = true;
    textarea.readOnly = true;
    textarea.inputMode = 'none';
    textarea.tabIndex = -1;
    textarea.blur();
    return;
  }

  const snapshot = snapshots.get(textarea);
  if (!snapshot) return;
  textarea.disabled = snapshot.disabled;
  textarea.readOnly = snapshot.readOnly;
  textarea.inputMode = snapshot.inputMode;
  if (snapshot.tabIndexAttribute === null) {
    textarea.removeAttribute('tabindex');
  } else {
    textarea.setAttribute('tabindex', snapshot.tabIndexAttribute);
  }
  snapshots.delete(textarea);
}
