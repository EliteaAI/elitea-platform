/**
 * Reads/writes the selected-project id+name. Storage keys
 * (`el.project.id`/`el.project.name`) are deliberately the SAME logical
 * keys `shared/lib/storage.ts`'s own doc comment cites as its example
 * (`local:el.project.id`) and that unit X5 (spec Wave-3,
 * `src/shared/lib/storageMigration.ts`) is chartered to migrate the OLD
 * app's `elitea_ui.project.id`/`.name` INTO — i.e. this widget is the
 * intended first writer of that namespaced key, not an invented one.
 *
 * `createStorage('local')` called fresh per function, not cached at this
 * module's top level — see `widgets/sidebar/lib/collapsedPersistence.ts`'s
 * header for why that specific pattern matters under vitest 4 + Node 24.
 */
import { createStorage } from '@/shared/lib/storage';

const ID_KEY = 'project.id';
const NAME_KEY = 'project.name';

export interface PersistedProject {
  readonly id: string;
  readonly name: string;
}

export function readPersistedProject(): PersistedProject | null {
  const storage = createStorage('local');
  const id = storage.get(ID_KEY);
  const name = storage.get(NAME_KEY);
  if (id === null || name === null) return null;
  return { id, name };
}

export function writePersistedProject(project: PersistedProject): void {
  const storage = createStorage('local');
  storage.set(ID_KEY, project.id);
  storage.set(NAME_KEY, project.name);
}
