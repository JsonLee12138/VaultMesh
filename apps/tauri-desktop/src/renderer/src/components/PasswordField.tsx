import { useState, type ReactNode } from 'react';
import { EyeIcon, EyeOffIcon } from 'lucide-react';

import { Field, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  inputMode?: 'text' | 'numeric' | undefined;
  placeholder?: string | undefined;
  autoFocus?: boolean | undefined;
  trailingAction?: ReactNode;
  onChange(value: string): void;
}

export function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <Field>
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={props.id}
          type={visible ? 'text' : 'password'}
          value={props.value}
          minLength={props.minLength}
          maxLength={props.maxLength ?? 10_000}
          inputMode={props.inputMode}
          placeholder={props.placeholder}
          autoFocus={props.autoFocus}
          autoComplete="off"
          spellCheck={false}
          required={props.minLength !== undefined}
          onChange={(event) => props.onChange(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
          type="button"
          aria-label={visible ? '隐藏密码' : '显示密码'}
          onClick={() => setVisible((value) => !value)}
        >
            {visible ? <EyeOffIcon data-icon="inline-start" /> : <EyeIcon data-icon="inline-start" />}
          </InputGroupButton>
          {props.trailingAction}
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}
