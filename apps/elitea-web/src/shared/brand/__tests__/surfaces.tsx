import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

import { App } from '@/app/App';

import { muiOverrides } from '../mui-overrides';

/**
 * The render surface for §4.6 check 7 assertion (c).
 *
 * The spec's wording is "the full route tree". There is no route tree yet —
 * unit R1 owns it and has not landed — so this registry is the honest
 * substitute AND the mechanism that makes the sweep widen by itself:
 *
 *  - `OVERRIDE_SURFACES` must contain an entry for every key
 *    `muiOverrides()` wires. The contract test asserts that, so the day unit
 *    S1 adds `MuiTextField` to the override package, this test fails until a
 *    TextField surface is added here. The sweep cannot silently stay narrow.
 *  - `ALWAYS_ON_SURFACES` covers the palette-driven MUI surfaces that render
 *    regardless of our overrides — in particular `Alert`, which is where
 *    `palette.error` / `palette.success` reach the DOM.
 *  - `APP_SURFACES` renders whatever application shell currently exists.
 *
 * REMOVER: unit R1 — when the route tree lands, add it here (or replace
 * APP_SURFACES with a router render) so the sweep covers real routes.
 */

const OVERRIDE_SURFACES: Record<string, () => React.ReactElement> = {
  MuiButton: () => (
    <>
      <Button variant="contained">contained</Button>
      <Button variant="secondary">secondary</Button>
      <Button variant="special">special</Button>
      <Button variant="auxiliary">auxiliary</Button>
      <Button variant="iconCounter">iconCounter</Button>
      <Button variant="maxi">maxi</Button>
      <Button variant="contained" disabled>
        disabled
      </Button>
    </>
  ),
  MuiChip: () => (
    <>
      <Chip label="filled" />
      <Chip label="outlined" variant="outlined" />
    </>
  ),
};

const ALWAYS_ON_SURFACES: Record<string, () => React.ReactElement> = {
  Paper: () => <Paper elevation={2}>paper</Paper>,
  Alert: () => (
    <>
      <Alert severity="error" variant="filled">
        error
      </Alert>
      <Alert severity="success" variant="filled">
        success
      </Alert>
      <Alert severity="warning" variant="standard">
        warning
      </Alert>
      <Alert severity="info" variant="outlined">
        info
      </Alert>
    </>
  ),
  Typography: () => (
    <>
      <Typography variant="headingLarge">headingLarge</Typography>
      <Typography variant="bodyMedium">bodyMedium</Typography>
      <Typography variant="subtitle">subtitle</Typography>
    </>
  ),
};

const APP_SURFACES: Record<string, () => React.ReactElement> = {
  App: () => <App />,
};

/** Every surface, in a stable order. */
export function AllSurfaces() {
  const entries = [
    ...Object.entries(OVERRIDE_SURFACES),
    ...Object.entries(ALWAYS_ON_SURFACES),
    ...Object.entries(APP_SURFACES),
  ];
  return (
    <div>
      {entries.map(([name, Surface]) => (
        <section key={name} data-surface={name}>
          <Surface />
        </section>
      ))}
    </div>
  );
}

/** Keys the sweep claims to cover — asserted against `muiOverrides()`. */
export const COVERED_OVERRIDE_KEYS = Object.keys(OVERRIDE_SURFACES);

export const WIRED_OVERRIDE_KEYS = Object.keys(muiOverrides());
