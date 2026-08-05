/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/hooks/
 * useParseSections.hooks.js` (21 lines, Wave-2 unit A4b). Flattens a
 * toolkit-type schema's `metadata.sections` into the flat `sectionProps`
 * array `ToolBase.jsx`/`toolBase.helpers.ts`'s `validateRequiredFields`
 * consume to exclude section-owned fields from the top-level required-field
 * check. Pure `useMemo` wrapper, no external dependencies.
 */
import { useMemo } from 'react';

/** Not exported: no current caller needs these two apart from `ParseSectionsSchema`/`UseParseSectionsResult` below. */
interface ParseSectionsSubsection {
  readonly fields?: readonly string[];
}

interface ParseSectionsSection {
  readonly subsections?: readonly ParseSectionsSubsection[];
}

export interface ParseSectionsSchema {
  readonly metadata?: {
    readonly sections?: Readonly<Record<string, ParseSectionsSection>>;
  };
}

export interface UseParseSectionsResult {
  readonly sections: Readonly<Record<string, ParseSectionsSection>>;
  readonly sectionProps: readonly string[];
}

/** Flattens every subsection's `fields` array across every section into one `sectionProps` list, alongside the raw `sections` map itself. */
export function useParseSections(schema: ParseSectionsSchema | undefined): UseParseSectionsResult {
  return useMemo(() => {
    const sectionsObject = schema?.metadata?.sections ?? {};
    let sectionPropsArray: string[] = [];
    for (const value of Object.values(sectionsObject)) {
      for (const section of value.subsections ?? []) {
        sectionPropsArray = [...sectionPropsArray, ...(section.fields ?? [])];
      }
    }
    return {
      sections: sectionsObject,
      sectionProps: sectionPropsArray,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mirrors the baseline's own dep array (`[schema?.metadata?.sections]`), not `[schema]`
  }, [schema?.metadata?.sections]);
}
