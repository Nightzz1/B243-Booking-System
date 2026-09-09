export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startWeeklyBookingCleanup } = await import('./lib/maintenance');
  startWeeklyBookingCleanup();
}
