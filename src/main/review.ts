import { FSRS, Rating, type Card } from 'ts-fsrs'
import { Store } from './store'
import type { Keep, ProfileId, SavedCard } from '../shared/domain'
import { nextLevel, type ReviewRating } from '../shared/review'
export { nextLevel, dueKeeps } from '../shared/review'
const scheduler = new FSRS({ enable_fuzz: false })
const grades = { Again: Rating.Again, Hard: Rating.Hard, Good: Rating.Good } as const
export class Reviews {
  constructor(readonly store: Store) {}
  async grade(profile: ProfileId, id: string, rating: ReviewRating, operationId: string, now = new Date()): Promise<void> {
    await this.store.update(state => {
      const keep = state.profiles[profile].keeps.find(item => item.id === id)
      if (!keep || !keep.active) throw new Error('该 Keep 已移出复习')
      if (keep.reviews.some(review => review.operationId === operationId)) return
      if (new Date(keep.card.due).getTime() > now.getTime()) throw new Error('该卡片尚未到期，请刷新复习队列')
      const card: Card = { ...keep.card, due: new Date(keep.card.due), last_review: keep.card.last_review ? new Date(keep.card.last_review) : undefined }
      const result = scheduler.next(card, now, grades[rating])
      const next: SavedCard = { ...result.card, due: result.card.due.toISOString(), last_review: result.card.last_review?.toISOString() }
      keep.card = next
      keep.level = nextLevel(keep.level, rating)
      keep.updatedAt = now.toISOString()
      keep.reviews.push({ operationId, at: now.toISOString(), rating, log: JSON.parse(JSON.stringify(result.log)) })
    })
  }
}
