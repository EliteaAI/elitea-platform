import { getEnvVar } from '@/entries/maintenance/env';

export const VITE_MAINTENANCE_MESSAGE = getEnvVar('VITE_MAINTENANCE_MESSAGE');
export const VITE_MAINTENANCE_START = getEnvVar('VITE_MAINTENANCE_START');
export const VITE_MAINTENANCE_END = getEnvVar('VITE_MAINTENANCE_END');
