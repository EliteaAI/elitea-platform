import { fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { FileReaderInput, parseFileContent, validateFile } from '.';

function makeFile(name: string, content: string, type = 'text/plain'): File {
  return new File([content], name, { type });
}

describe('validateFile', () => {
  it('accepts any file when no options are given', () => {
    expect(validateFile(makeFile('a.bin', 'x'), undefined)).toBeNull();
  });

  it('accepts a file whose extension is in acceptExtensions', () => {
    expect(validateFile(makeFile('a.json', '{}'), { acceptExtensions: ['json', 'yaml'] })).toBeNull();
  });

  it('rejects a file whose extension is not in acceptExtensions', () => {
    expect(validateFile(makeFile('a.exe', 'x'), { acceptExtensions: ['json', 'yaml'] })).toBe('extension');
  });

  it('is case-insensitive about the extension', () => {
    expect(validateFile(makeFile('A.JSON', '{}'), { acceptExtensions: ['json'] })).toBeNull();
  });

  it('rejects a file with no extension when acceptExtensions is set', () => {
    expect(validateFile(makeFile('README', 'x'), { acceptExtensions: ['json'] })).toBe('extension');
  });

  it('accepts a file at exactly maxSizeBytes', () => {
    const file = makeFile('a.txt', 'x'.repeat(10));
    expect(validateFile(file, { maxSizeBytes: file.size })).toBeNull();
  });

  it('rejects a file over maxSizeBytes', () => {
    const file = makeFile('a.txt', 'x'.repeat(10));
    expect(validateFile(file, { maxSizeBytes: file.size - 1 })).toBe('size');
  });

  it('checks extension before size (extension wins when both would fail)', () => {
    const file = makeFile('a.exe', 'x'.repeat(10));
    expect(validateFile(file, { acceptExtensions: ['txt'], maxSizeBytes: 1 })).toBe('extension');
  });
});

describe('parseFileContent', () => {
  it('passes plain-text content through unchanged', () => {
    expect(parseFileContent('hello world', 'notes.txt')).toBe('hello world');
  });

  it('parses a .yaml file and re-serialises it as JSON', () => {
    expect(parseFileContent('a: 1\nb: two\n', 'config.yaml')).toBe(JSON.stringify({ a: 1, b: 'two' }));
  });

  it('parses a .yml file the same way as .yaml', () => {
    expect(parseFileContent('a: 1\n', 'config.yml')).toBe(JSON.stringify({ a: 1 }));
  });

  it('is case-insensitive about the yaml extension', () => {
    expect(parseFileContent('a: 1\n', 'CONFIG.YAML')).toBe(JSON.stringify({ a: 1 }));
  });

  it('throws on unparsable YAML', () => {
    expect(() => parseFileContent('a: [1, 2\n', 'bad.yaml')).toThrow();
  });

  it('passes JSON file content through unchanged (no re-parsing)', () => {
    const json = JSON.stringify({ a: 1 });
    expect(parseFileContent(json, 'config.json')).toBe(json);
  });
});

describe('FileReaderInput', () => {
  it('renders the label and current value', () => {
    const { getByLabelText } = renderWithTheme(
      <FileReaderInput
        label="Context"
        value="hello"
        onChange={() => {}}
      />,
    );
    expect(getByLabelText('Context')).toHaveValue('hello');
  });

  it('propagates typed edits via onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { getByLabelText } = renderWithTheme(
      <FileReaderInput
        label="Context"
        value=""
        onChange={onChange}
      />,
    );
    await user.type(getByLabelText('Context'), 'x');
    expect(onChange).toHaveBeenCalled();
  });

  it('renders an "Attach a file" button and a hidden native file input', () => {
    const { getByRole, container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={() => {}}
      />,
    );
    expect(getByRole('button', { name: 'Attach a file' })).toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('clicking "Attach a file" opens the native file picker (delegates to the hidden input)', async () => {
    const user = userEvent.setup();
    const { getByRole, container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={() => {}}
      />,
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {});
    await user.click(getByRole('button', { name: 'Attach a file' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('reads a picked file via the native input and calls onChange with its content', async () => {
    const onChange = vi.fn();
    const onFileAccepted = vi.fn();
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={onChange}
        onFileAccepted={onFileAccepted}
      />,
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('notes.txt', 'picked content');
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('picked content');
    });
    expect(onFileAccepted).toHaveBeenCalledWith(file);
  });

  it('resets the native input value after reading, so the same file can be re-picked', async () => {
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={onChange}
      />,
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeFile('notes.txt', 'content');
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(fileInput.value).toBe('');
  });

  it('reads a dropped file and calls onChange with its content', async () => {
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={onChange}
      />,
    );
    const dropzone = container.firstElementChild as HTMLElement;
    const file = makeFile('dropped.txt', 'dropped content');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('dropped content');
    });
  });

  it('parses a dropped YAML file into JSON, same as the baseline', async () => {
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={onChange}
      />,
    );
    const dropzone = container.firstElementChild as HTMLElement;
    const file = makeFile('config.yaml', 'key: value\n', 'application/x-yaml');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(JSON.stringify({ key: 'value' }));
    });
  });

  it('toggles a data-dragging marker across dragOver/dragLeave', () => {
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={() => {}}
      />,
    );
    const dropzone = container.firstElementChild as HTMLElement;
    expect(dropzone).toHaveAttribute('data-dragging', 'false');
    fireEvent.dragOver(dropzone, { dataTransfer: { files: [] } });
    expect(dropzone).toHaveAttribute('data-dragging', 'true');
    fireEvent.dragLeave(dropzone, { dataTransfer: { files: [] } });
    expect(dropzone).toHaveAttribute('data-dragging', 'false');
  });

  it('clears the dragging marker once a file is dropped', () => {
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={() => {}}
      />,
    );
    const dropzone = container.firstElementChild as HTMLElement;
    fireEvent.dragOver(dropzone, { dataTransfer: { files: [] } });
    expect(dropzone).toHaveAttribute('data-dragging', 'true');
    const file = makeFile('a.txt', 'content');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(dropzone).toHaveAttribute('data-dragging', 'false');
  });

  it('rejects a dropped file that fails the extension gate, without calling onChange', async () => {
    const onChange = vi.fn();
    const onFileRejected = vi.fn();
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={onChange}
        file={{ acceptExtensions: ['json'] }}
        onFileRejected={onFileRejected}
      />,
    );
    const dropzone = container.firstElementChild as HTMLElement;
    const file = makeFile('script.exe', 'binary-ish');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onFileRejected).toHaveBeenCalledWith(file, 'extension');
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects a dropped file that fails the size gate, without calling onChange', async () => {
    const onChange = vi.fn();
    const onFileRejected = vi.fn();
    const file = makeFile('big.txt', 'x'.repeat(100));
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={onChange}
        file={{ maxSizeBytes: 10 }}
        onFileRejected={onFileRejected}
      />,
    );
    const dropzone = container.firstElementChild as HTMLElement;
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onFileRejected).toHaveBeenCalledWith(file, 'size');
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a parse rejection for unparsable YAML without calling onChange', async () => {
    const onChange = vi.fn();
    const onFileRejected = vi.fn();
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={onChange}
        onFileRejected={onFileRejected}
      />,
    );
    const dropzone = container.firstElementChild as HTMLElement;
    const file = makeFile('bad.yaml', 'a: [1, 2\n');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onFileRejected).toHaveBeenCalledWith(file, 'parse');
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a parse rejection when the underlying FileReader itself errors (not a content-parse failure)', async () => {
    // A distinct failure mode from "unparsable YAML": the read operation
    // itself fails (permissions, I/O, a locked file) before any content is
    // available to parse. `readAsText` fires `onerror` instead of `onload`
    // in that case — jsdom's own `FileReader` has no way to simulate this,
    // so this test supplies a minimal fake covering exactly that path.
    class FailingFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      readAsText(): void {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('FileReader', FailingFileReader);

    const onChange = vi.fn();
    const onFileRejected = vi.fn();
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={onChange}
        onFileRejected={onFileRejected}
      />,
    );
    const dropzone = container.firstElementChild as HTMLElement;
    const file = makeFile('notes.txt', 'content');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(onFileRejected).toHaveBeenCalledWith(file, 'parse');
    });
    expect(onChange).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does nothing when the native file picker is cancelled (no file chosen)', () => {
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={onChange}
      />,
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does nothing when a drop event carries no files', () => {
    const onChange = vi.fn();
    const { container } = renderWithTheme(
      <FileReaderInput
        value=""
        onChange={onChange}
      />,
    );
    const dropzone = container.firstElementChild as HTMLElement;
    fireEvent.drop(dropzone, { dataTransfer: { files: [] } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
