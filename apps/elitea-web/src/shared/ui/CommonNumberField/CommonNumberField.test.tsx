import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { CommonNumberField } from '.';

describe('CommonNumberField', () => {
  describe('text-input branch (no min/max field-value range)', () => {
    it('renders the current value', () => {
      const { getByRole } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={5}
          meta={{ label: 'Count' }}
          fieldType="integer"
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('textbox')).toHaveValue('5');
    });

    it('renders an empty input for a null value', () => {
      const { getByRole } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={null}
          meta={{ label: 'Count' }}
          fieldType="integer"
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('textbox')).toHaveValue('');
    });

    it('parses integer input, stripping non-digit characters', () => {
      const onChange = vi.fn();
      const { getByRole } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={null}
          meta={{ label: 'Count' }}
          fieldType="integer"
          onChange={onChange}
        />,
      );
      // A fully-controlled `value` prop that this test never feeds back in
      // means `user.type`'s per-keystroke simulation would bounce the input
      // back to the original (empty) value between keys — `fireEvent.change`
      // fires one native change event with the complete raw string, which is
      // what actually exercises the parser end to end.
      fireEvent.change(getByRole('textbox'), { target: { value: '4a2' } });
      expect(onChange).toHaveBeenCalledWith('count', 42);
    });

    it('reports null (not 0 or NaN) when the integer input is cleared', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { getByRole } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={7}
          meta={{ label: 'Count' }}
          fieldType="integer"
          onChange={onChange}
        />,
      );
      await user.clear(getByRole('textbox'));
      expect(onChange).toHaveBeenLastCalledWith('count', null);
    });

    it('parses float input for fieldType="number"', () => {
      const onChange = vi.fn();
      const { getByRole } = renderWithTheme(
        <CommonNumberField
          fieldKey="ratio"
          value={null}
          meta={{ label: 'Ratio' }}
          fieldType="number"
          onChange={onChange}
        />,
      );
      // A native `<input type="number">` (fieldType="number") has the
      // implicit ARIA role "spinbutton", not "textbox" (that's only true
      // for `type="tel"`, the integer branch's input type).
      fireEvent.change(getByRole('spinbutton'), { target: { value: '3.5' } });
      expect(onChange).toHaveBeenCalledWith('ratio', 3.5);
    });

    it('shows no error for a value with no constraints', () => {
      const { getByRole } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={5}
          meta={{ label: 'Count' }}
          fieldType="integer"
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('textbox')).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('flags a value below minimum', () => {
      const { getByRole, getByText } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={1}
          meta={{ label: 'Count' }}
          property={{ minimum: 5 }}
          fieldType="integer"
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
      expect(getByText('Value must be at least 5')).toBeInTheDocument();
    });

    it('flags a value at exclusiveMinimum (boundary excluded)', () => {
      const { getByText } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={5}
          meta={{ label: 'Count' }}
          property={{ exclusiveMinimum: 5 }}
          fieldType="integer"
          onChange={vi.fn()}
        />,
      );
      expect(getByText('Value must be greater than 5')).toBeInTheDocument();
    });

    it('flags a value above maximum', () => {
      const { getByText } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={100}
          meta={{ label: 'Count' }}
          property={{ maximum: 10 }}
          fieldType="integer"
          onChange={vi.fn()}
        />,
      );
      expect(getByText('Value must be at most 10')).toBeInTheDocument();
    });

    it('flags a value at exclusiveMaximum (boundary excluded)', () => {
      const { getByText } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={10}
          meta={{ label: 'Count' }}
          property={{ exclusiveMaximum: 10 }}
          fieldType="integer"
          onChange={vi.fn()}
        />,
      );
      expect(getByText('Value must be less than 10')).toBeInTheDocument();
    });

    it('resolves constraints from inside an anyOf (Optional-type) branch', () => {
      const { getByText } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={1}
          meta={{ label: 'Count' }}
          property={{ anyOf: [{ type: 'null' }, { type: 'integer', minimum: 5 }] }}
          fieldType="integer"
          onChange={vi.fn()}
        />,
      );
      expect(getByText('Value must be at least 5')).toBeInTheDocument();
    });

    it('does not validate a null value', () => {
      const { queryByText } = renderWithTheme(
        <CommonNumberField
          fieldKey="count"
          value={null}
          meta={{ label: 'Count' }}
          property={{ minimum: 5 }}
          fieldType="integer"
          onChange={vi.fn()}
        />,
      );
      expect(queryByText(/Value must/)).not.toBeInTheDocument();
    });
  });

  describe('slider branch (minFieldValue and maxFieldValue both given)', () => {
    it('renders a slider labelled with the range', () => {
      const { getByRole } = renderWithTheme(
        <CommonNumberField
          fieldKey="volume"
          value={5}
          meta={{ label: 'Volume' }}
          fieldType="integer"
          minFieldValue={0}
          maxFieldValue={10}
          onChange={vi.fn()}
        />,
      );
      const slider = getByRole('slider');
      expect(slider).toHaveAttribute('aria-valuenow', '5');
      expect(slider).toHaveAttribute('aria-valuemin', '0');
      expect(slider).toHaveAttribute('aria-valuemax', '10');
    });

    it('falls back to the schema default, then to the minimum, when value is not set', () => {
      const { getByRole, rerender } = renderWithTheme(
        <CommonNumberField
          fieldKey="volume"
          value={null}
          meta={{ label: 'Volume' }}
          property={{ default: 3 }}
          fieldType="integer"
          minFieldValue={0}
          maxFieldValue={10}
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('slider')).toHaveAttribute('aria-valuenow', '3');

      rerender(
        <CommonNumberField
          fieldKey="volume"
          value={null}
          meta={{ label: 'Volume' }}
          fieldType="integer"
          minFieldValue={2}
          maxFieldValue={10}
          onChange={vi.fn()}
        />,
      );
      expect(getByRole('slider')).toHaveAttribute('aria-valuenow', '2');
    });

    it('moves the slider and calls onChange with the field key and new value', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { getByRole } = renderWithTheme(
        <CommonNumberField
          fieldKey="volume"
          value={5}
          meta={{ label: 'Volume' }}
          fieldType="integer"
          minFieldValue={0}
          maxFieldValue={10}
          onChange={onChange}
        />,
      );
      const slider = getByRole('slider');
      slider.focus();
      await user.keyboard('{ArrowRight}');
      expect(onChange).toHaveBeenCalledWith('volume', 6);
    });

    it('disables the slider when meta.disabled is set', () => {
      const { getByRole } = renderWithTheme(
        <CommonNumberField
          fieldKey="volume"
          value={5}
          meta={{ label: 'Volume', disabled: true }}
          fieldType="integer"
          minFieldValue={0}
          maxFieldValue={10}
          onChange={vi.fn()}
        />,
      );
      // MUI's `Slider` renders `role="slider"` on the native
      // `<input type="range">`, which carries the real `disabled` attribute
      // (the `Mui-disabled` CSS class lands on the root/thumb wrapper spans
      // instead, not on this element).
      expect(getByRole('slider')).toBeDisabled();
    });
  });
});
