import { create } from 'zustand';

interface FooState {
  count: number;
}

export const useFooStore = create<FooState>()(() => ({ count: 0 }));
