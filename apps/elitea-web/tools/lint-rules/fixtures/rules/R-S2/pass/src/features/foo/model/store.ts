import { create } from 'zustand';

interface FooState {
  count: number;
}

export function createFooStore() {
  return create<FooState>()(() => ({ count: 0 }));
}
