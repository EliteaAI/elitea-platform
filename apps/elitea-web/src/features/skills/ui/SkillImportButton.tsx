import type { ChangeEvent, ReactNode } from 'react';
import { useRef, useState } from 'react';

import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BaseModal } from '@/shared/ui/BaseModal';

import { parseSkillMarkdown } from '../lib/skillImport';
import type { SkillDraft } from '../model/types';

export interface SkillImportButtonProps {
  readonly isImporting: boolean;
  readonly onImport: (file: File) => Promise<void>;
}

export function SkillImportButton({ isImporting, onImport }: SkillImportButtonProps): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ readonly file: File; readonly draft: SkillDraft }>();
  const [error, setError] = useState<string>();

  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.md')) {
      setError(t('skills.import.onlyMarkdown', 'Only .md files can be imported.'));
      return;
    }
    try {
      setPending({ file, draft: parseSkillMarkdown(await file.text()) });
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('skills.import.invalid', 'Invalid skill file.'));
    }
  };

  return (
    <>
      <BaseBtn
        variant="secondary"
        startIcon={<UploadFileOutlinedIcon />}
        disabled={isImporting}
        onClick={() => inputRef.current?.click()}
      >
        {t('skills.import.button', 'Import')}
      </BaseBtn>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept=".md,text/markdown"
        onChange={(event) => {
          void handleFile(event);
        }}
      />
      {error && <Typography role="alert">{error}</Typography>}
      <BaseModal
        open={pending !== undefined}
        title={t('skills.import.title', 'Import skill')}
        onClose={() => setPending(undefined)}
        onConfirm={() => {
          if (!pending) return;
          void onImport(pending.file).then(() => setPending(undefined));
        }}
        actions={{
          confirmText: t('skills.import.confirm', 'Import'),
          confirming: isImporting,
        }}
        content={
          pending ? (
            <Box>
              <Typography variant="headingSmall">{pending.draft.name}</Typography>
              <Typography>{pending.draft.description}</Typography>
              <Typography variant="bodySmall">
                {t('skills.import.file', 'File')}: {pending.file.name}
              </Typography>
            </Box>
          ) : null
        }
      />
    </>
  );
}
