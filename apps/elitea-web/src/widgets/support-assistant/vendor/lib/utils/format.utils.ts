
export const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return time;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isYesterday) return `Yesterday, ${time}`;

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time;
};
