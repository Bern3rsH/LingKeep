import type { Keep } from './domain'
export type ReviewRating = 'Again' | 'Hard' | 'Good'
export function dueKeeps(keeps: Keep[], now = new Date()): Keep[] {
  return keeps.filter(keep => keep.active && new Date(keep.card.due).getTime() <= now.getTime()).sort((a, b) => a.card.due.localeCompare(b.card.due))
}
export function nextLevel(level: number, rating: ReviewRating): number {
  return rating === 'Again' ? 1 : rating === 'Hard' ? Math.max(1, level - 1) : Math.min(5, level + 1)
}
