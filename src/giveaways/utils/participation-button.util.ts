export const PARTICIPATION_BUTTON_STYLES = [
  'primary',
  'success',
  'danger',
] as const;

export type ParticipationButtonStyle =
  (typeof PARTICIPATION_BUTTON_STYLES)[number];

export function parseParticipationButtonStyle(
  value: string | undefined | null,
): ParticipationButtonStyle | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return null;
  if (
    !PARTICIPATION_BUTTON_STYLES.includes(
      trimmed as ParticipationButtonStyle,
    )
  ) {
    throw new Error(
      `Invalid participationButtonStyle: ${value}. Must be one of: ${PARTICIPATION_BUTTON_STYLES.join(', ')}`,
    );
  }
  return trimmed as ParticipationButtonStyle;
}

export function parseShowParticipationCount(
  value: string | undefined,
): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 'true';
}
