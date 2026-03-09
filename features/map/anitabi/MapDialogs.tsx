'use client'

import * as Dialog from '@radix-ui/react-dialog'
import type { Dispatch, SetStateAction } from 'react'
import type { AnitabiBangumiDTO, AnitabiPointDTO } from '@/lib/anitabi/types'
import CheckInCard from '@/components/share/CheckInCard'
import ComparisonImageGenerator from '@/components/comparison/ComparisonImageGenerator'
import QuickPilgrimageMode from '@/components/quickPilgrimage/QuickPilgrimageMode'
import RouteBookCard from '@/components/share/RouteBookCard'
import { L, LOCATION_DIALOG_DISMISSED_KEY, type RouteBookListItem } from './shared'

type ImagePreview = {
  src: string
  name: string
  saveUrl: string
}

type MapDialogsProps = {
  locale: 'zh' | 'en' | 'ja'
  label: (typeof L)['zh']
  detail: AnitabiBangumiDTO | null
  selectedPoint: AnitabiPointDTO | null
  showQuickPilgrimage: boolean
  quickPilgrimageStates: Record<string, string>
  setShowQuickPilgrimage: Dispatch<SetStateAction<boolean>>
  onQuickPilgrimageStatesUpdated: () => void
  routeBookPickerOpen: boolean
  setRouteBookPickerOpen: Dispatch<SetStateAction<boolean>>
  routeBookPickerLoading: boolean
  routeBookItems: RouteBookListItem[]
  routeBookPickerSaving: boolean
  addSelectedPointToRouteBook: (routeBookId: string) => Promise<void>
  routeBookTitleDraft: string
  setRouteBookTitleDraft: Dispatch<SetStateAction<string>>
  createRouteBookAndAddPoint: () => Promise<void>
  routeBookPickerError: string | null
  imagePreview: ImagePreview | null
  onImagePreviewOpenChange: (open: boolean) => void
  imageSaving: boolean
  saveOriginalImage: () => Promise<void>
  imageSaveError: string | null
  showCheckInCard: boolean
  setShowCheckInCard: Dispatch<SetStateAction<boolean>>
  showRouteBookCard: boolean
  setShowRouteBookCard: Dispatch<SetStateAction<boolean>>
  showComparisonGenerator: boolean
  setShowComparisonGenerator: Dispatch<SetStateAction<boolean>>
  comparisonImageUrl: string | null
  selectedPointImagePreviewUrl: string | null
  selectedPointImageDownloadUrl: string | null
  totalRouteDistance: string
  routeBookPoints: Array<{ lat: number; lng: number }>
  checkedInThumbnails: string[]
  onComparisonSuccess: (blob: Blob) => void
  locationDialogOpen: boolean
  setLocationDialogOpen: Dispatch<SetStateAction<boolean>>
  onLocationDialogGrant: () => void
}

export default function MapDialogs(props: MapDialogsProps) {
  const {
    locale,
    label,
    detail,
    selectedPoint,
    showQuickPilgrimage,
    quickPilgrimageStates,
    setShowQuickPilgrimage,
    onQuickPilgrimageStatesUpdated,
    routeBookPickerOpen,
    setRouteBookPickerOpen,
    routeBookPickerLoading,
    routeBookItems,
    routeBookPickerSaving,
    addSelectedPointToRouteBook,
    routeBookTitleDraft,
    setRouteBookTitleDraft,
    createRouteBookAndAddPoint,
    routeBookPickerError,
    imagePreview,
    onImagePreviewOpenChange,
    imageSaving,
    saveOriginalImage,
    imageSaveError,
    showCheckInCard,
    setShowCheckInCard,
    showRouteBookCard,
    setShowRouteBookCard,
    showComparisonGenerator,
    setShowComparisonGenerator,
    comparisonImageUrl,
    selectedPointImagePreviewUrl,
    selectedPointImageDownloadUrl,
    totalRouteDistance,
    routeBookPoints,
    checkedInThumbnails,
    onComparisonSuccess,
    locationDialogOpen,
    setLocationDialogOpen,
    onLocationDialogGrant,
  } = props

  return (
    <>
      {showQuickPilgrimage && detail ? (
        <QuickPilgrimageMode
          bangumi={detail}
          userPointStates={quickPilgrimageStates}
          onClose={() => setShowQuickPilgrimage(false)}
          onStatesUpdated={onQuickPilgrimageStatesUpdated}
        />
      ) : null}

      <Dialog.Root open={routeBookPickerOpen} onOpenChange={setRouteBookPickerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl focus:outline-none">
            <Dialog.Title className="text-sm font-semibold text-slate-900">{label.routeBookSelectTitle}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-slate-500">{label.routeBookPickOne}</Dialog.Description>

            {routeBookPickerLoading ? (
              <div className="mt-4 text-sm text-slate-500">{label.routeBookLoading}</div>
            ) : (
              <div className="mt-3 space-y-2">
                {routeBookItems.length > 0 ? (
                  <div className="max-h-44 space-y-2 overflow-y-auto">
                    {routeBookItems.map((book) => (
                      <button
                        key={book.id}
                        type="button"
                        disabled={routeBookPickerSaving}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => {
                          void addSelectedPointToRouteBook(book.id)
                        }}
                      >
                        <span className="truncate">{book.title}</span>
                        <span className="ml-2 text-xs text-slate-400">{book.status}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">{label.routeBookEmpty}</div>
                )}
              </div>
            )}

            <div className="mt-4 space-y-2">
              <input
                type="text"
                value={routeBookTitleDraft}
                onChange={(event) => setRouteBookTitleDraft(event.target.value)}
                placeholder={label.routeBookCreatePlaceholder}
                maxLength={100}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                disabled={routeBookPickerSaving || !routeBookTitleDraft.trim()}
                className="w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  void createRouteBookAndAddPoint()
                }}
              >
                {routeBookPickerSaving ? label.loading : label.routeBookCreateAndAdd}
              </button>
            </div>

            {routeBookPickerError ? (
              <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{routeBookPickerError}</div>
            ) : null}

            <div className="mt-4 flex justify-end">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                >
                  {label.close}
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={Boolean(imagePreview)} onOpenChange={onImagePreviewOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-[1px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[121] min-w-[320px] max-w-[92vw] w-fit -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl focus:outline-none sm:p-4">
            <Dialog.Description className="sr-only">
              {locale === 'en' ? 'Image preview with manual save action' : locale === 'ja' ? '画像プレビューと手动保存操作' : '图片预览与手动保存'}
            </Dialog.Description>
            <div className="mb-3 flex items-center justify-between gap-2">
              <Dialog.Title className="line-clamp-1 text-sm font-semibold text-slate-900">
                {imagePreview?.name || label.previewImage}
              </Dialog.Title>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowComparisonGenerator(true)}
                  className="rounded border border-brand-300 bg-brand-50 px-2 py-1 text-xs text-brand-700 hover:bg-brand-100"
                >
                  制作对比图
                </button>
                {imagePreview?.saveUrl ? (
                  <button
                    type="button"
                    onClick={() => {
                      void saveOriginalImage()
                    }}
                    disabled={imageSaving}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 no-underline hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {imageSaving ? label.savingOriginal : label.saveOriginal}
                  </button>
                ) : null}
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  >
                    {label.close}
                  </button>
                </Dialog.Close>
              </div>
            </div>
            {imageSaveError ? (
              <div className="mb-2 text-xs text-rose-600">{imageSaveError}</div>
            ) : null}
            {imagePreview?.src ? (
              <div className="max-h-[78dvh] overflow-auto rounded-lg bg-slate-100 p-1 sm:p-2">
                <img
                  src={imagePreview.src}
                  alt={imagePreview.name || label.previewImage}
                  className="mx-auto block h-auto max-h-[72dvh] w-auto max-w-[88vw] object-contain"
                />
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={showCheckInCard} onOpenChange={setShowCheckInCard}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none">
            <CheckInCard
              animeTitle={detail?.card.title || ''}
              pointName={selectedPoint?.name || ''}
              cityName={detail?.card.city || ''}
              imageUrl={comparisonImageUrl || selectedPointImagePreviewUrl || ''}
              shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
              onClose={() => setShowCheckInCard(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={showRouteBookCard} onOpenChange={setShowRouteBookCard}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none">
            <RouteBookCard
              animeTitle={detail?.card.titleZh || detail?.card.title || ''}
              routeBookTitle={`${detail?.card.city || ''}圣地巡礼`}
              cityName={detail?.card.city || ''}
              totalPoints={detail?.points.length || 0}
              totalDistance={totalRouteDistance}
              completionDate={new Date().toLocaleDateString('zh-CN')}
              points={routeBookPoints}
              featuredImages={checkedInThumbnails}
              shareUrl={typeof window !== 'undefined' ? window.location.href : ''}
              onClose={() => setShowRouteBookCard(false)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={showComparisonGenerator} onOpenChange={setShowComparisonGenerator}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 bottom-0 z-[131] w-full max-w-2xl -translate-x-1/2 focus:outline-none sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2">
            <ComparisonImageGenerator
              animeImage={selectedPointImageDownloadUrl || selectedPointImagePreviewUrl || ''}
              animeTitle={detail?.card.title || ''}
              pointName={selectedPoint?.name || ''}
              onClose={() => setShowComparisonGenerator(false)}
              onSuccess={onComparisonSuccess}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={locationDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setLocationDialogOpen(false)
          try {
            window.sessionStorage.setItem(LOCATION_DIALOG_DISMISSED_KEY, '1')
          } catch {
            // sessionStorage unavailable
          }
        }
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[130] bg-black/30 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-brand-100 bg-brand-50 p-5 shadow-2xl focus:outline-none">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-100">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 text-brand-600">
                <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
            </div>
            <Dialog.Title className="text-base font-semibold text-slate-900">{label.locationDialogTitle}</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-sm text-slate-600">{label.locationDialogBody}</Dialog.Description>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setLocationDialogOpen(false)
                  try {
                    window.sessionStorage.setItem(LOCATION_DIALOG_DISMISSED_KEY, '1')
                  } catch {
                    // sessionStorage unavailable
                  }
                }}
              >
                {label.locationDialogSkip}
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                onClick={onLocationDialogGrant}
              >
                {label.locationDialogGrant}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
