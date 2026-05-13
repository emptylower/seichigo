import { JournalCover } from './components/JournalCover'
import { PilgrimageMap } from './components/PilgrimageMap'
import { NotesPreview } from './components/NotesPreview'
import { TripsTimeline } from './components/TripsTimeline'
import { WorkProgress } from './components/WorkProgress'
import { AchievementWall } from './components/AchievementWall'
import { TravelModeDonut } from './components/TravelModeDonut'
import { PhotoAlbum } from './components/PhotoAlbum'
import { ExploreCards } from './components/ExploreCards'
import { NearbyFloatingButton } from './components/NearbyFloatingButton'
import type { JournalSnapshot } from '@/lib/journal/types'

export function JournalUi({ snapshot }: { snapshot: JournalSnapshot }) {
  const totalUnlocked = snapshot.achievements.filter((a) => a.unlocked).length
  return (
    <main className="max-w-[1440px] mx-auto px-10 py-12 bg-journal-paper">
      <JournalCover snapshot={snapshot} />

      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-7">
          <PilgrimageMap
            pointsVisited={snapshot.stats.pointsVisited}
            prefectures={snapshot.prefectures}
            pins={snapshot.pinsForMap}
          />
        </div>
        <div className="col-span-5">
          <NotesPreview recentNotes={snapshot.recentNotes} />
        </div>
      </div>

      <div className="mb-5">
        <TripsTimeline
          totalCheckins={snapshot.stats.totalCheckins}
          totalTrips={snapshot.stats.totalTrips}
          trips={snapshot.tripsForTimeline}
        />
      </div>

      <div className="grid grid-cols-12 gap-5 mb-5">
        <div className="col-span-5">
          <WorkProgress workProgress={snapshot.workProgress} />
        </div>
        <div className="col-span-4">
          <AchievementWall
            achievements={snapshot.achievements}
            nextAchievement={snapshot.nextAchievement}
            totalUnlocked={totalUnlocked}
          />
        </div>
        <div className="col-span-3">
          <TravelModeDonut breakdown={snapshot.travelModeBreakdown} />
        </div>
      </div>

      <div className="mb-16">
        <PhotoAlbum photos={snapshot.recentPhotos} />
      </div>

      <ExploreCards />

      <NearbyFloatingButton />
    </main>
  )
}
