async function work(): Promise<void> {
  await Promise.resolve();
}

export function go(): void {
  work();
}
