import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { ScrollableContainer } from '.';

const meta = {
  title: 'shared/ui/scrollable-container/ScrollableContainer',
  component: ScrollableContainer,
  parameters: { a11y: { test: 'error' } },
} satisfies Meta<typeof ScrollableContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

const tallContent = (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
    {Array.from({ length: 40 }, (_, index) => (
      <div key={index}>Row {index + 1}</div>
    ))}
  </div>
);

export const Default: Story = {
  args: { children: tallContent },
  decorators: [
    (Story) => (
      <div style={{ height: '12.5rem', width: '20rem' }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Row 1')).toBeInTheDocument();
    await expect(canvas.getByText('Row 40')).toBeInTheDocument();
  },
};

export const FitsToContent: Story = {
  args: {
    fillContainer: false,
    children: (
      <div>
        <div>Line 1</div>
        <div>Line 2</div>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ width: '20rem', maxHeight: '10rem' }}>
        <Story />
      </div>
    ),
  ],
};
