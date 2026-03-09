import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiBangumiDTO, AnitabiMapTab } from '@/lib/anitabi/types'
import { MobileVisualCenterBangumiRow, MobileVisualCenterPointStrip } from '@/components/map/MobileVisualCenterOverlay'
import { PointPopupCard } from '@/components/map/PointPopupCard'
import { WindowExcerptOverlay } from '@/components/map/WindowExcerptOverlay'
import { MapModeToggle } from '@/components/map/MapModeToggle'
import MapLoadingProgress from '@/components/map/MapLoadingProgress'
import DetailPanel from './DetailPanel'
import ExplorerPanelContent from './ExplorerPanelContent'
import MapDialogs from './MapDialogs'
import MapShell from './MapShell'
import { geoLink, isValidGeoPair } from './media'

export default function AnitabiMapLayout(props: any) {
  const {
    locale,
    label,
    detail,
    detailCardMode,
    selectedPoint,
    selectedPointState,
    selectedPointDistanceMeters,
    selectedPointPanorama,
    detailLoading,
    workDetailExpanded,
    quickPilgrimageProgress,
    viewFilter,
    stateFilter,
    detailPoints,
    selectedPointImage,
    renderPointImage,
    showWantToGoAction,
    meState,
    formatDistance,
    clearActiveBangumiSelection,
    switchToBangumiDetail,
    setWorkDetailExpanded,
    setShowQuickPilgrimage,
    setViewFilter,
    setStateFilter,
    setDetailCardMode,
    setSelectedPointId,
    isDesktopRef,
    setMobilePointPopupOpen,
    mapViewMode,
    mapRef,
    focusGeo,
    addPointToPointPool,
    enterPanorama,
    styleMode,
    setStyleMode,
    onRandom,
    queryInput,
    query,
    setQueryInput,
    setQuery,
    searchOpen,
    setSearchOpen,
    searchResult,
    onSubmitQuery,
    selectedCity,
    setSelectedCity,
    bootstrap,
    tab,
    setTab,
    showNearbyLocationCta,
    locating,
    onLocate,
    loading,
    hasSearchQuery,
    cards,
    selectedBangumiId,
    openBangumi,
    handleCardPointerEnter,
    handleCardPointerLeave,
    cardsContainerRef,
    cardsLoadMoreRef,
    loadingMoreCards,
    cardsLoadError,
    loadMoreCards,
    hasMoreCards,
    mobilePanelOpen,
    mobilePointPopupOpen,
    mobilePointPopupAnchor,
    isDesktop,
    selectedPointPanoramaAvailable,
    windowExcerptBangumis,
    windowExcerptPoints,
    mapMode,
    showQuickPilgrimage,
    quickPilgrimageStates,
    loadMe,
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
    showRouteBookCard,
    setShowRouteBookCard,
    showComparisonGenerator,
    setShowComparisonGenerator,
    comparisonImageUrl,
    totalRouteDistance,
    checkedInThumbnails,
    setComparisonImageBlob,
    setComparisonImageUrl,
    setShowCheckInCard,
    locationDialogOpen,
    setLocationDialogOpen,
    locateUser,
    locateHint,
    warmupProgress,
    completeModeLoading,
  } = props

  const tabs = bootstrap?.tabs || [
    { key: 'nearby' as const, label: label.nearby },
    { key: 'latest' as const, label: label.latest },
    { key: 'recent' as const, label: label.recent },
    { key: 'hot' as const, label: label.hot },
  ]
  const warmupReady = warmupProgress.percent >= 100
  const warmupActive = warmupProgress.phase === 'loading' && !warmupReady
  const iconPreppingActive = completeModeLoading && !warmupActive
  const mergedLoadingVisible = warmupActive || iconPreppingActive
  const mergedLoadingPercent = iconPreppingActive ? 99 : warmupProgress.percent
  const mergedLoadingTitle = iconPreppingActive ? label.preloadIconsTitle : warmupProgress.title
  const mergedLoadingDetail = iconPreppingActive ? label.preloadIconsDetail : warmupProgress.detail
  const showWindowExcerptOverlay = mapViewMode === 'map'
    && mapMode === 'complete'
    && (windowExcerptBangumis.length > 0 || windowExcerptPoints.length > 0)
  const showMobileVisualCenter = !isDesktop
    && !mobilePanelOpen
    && !mobilePointPopupOpen
    && showWindowExcerptOverlay
  const mobilePanelButtonLabel = !isDesktop
    ? detailCardMode === 'point' && selectedPoint
      ? `${label.pointDetail} · ${selectedPoint.name}`
      : detail
        ? `${label.workDetail} · ${detail.card.title}`
        : label.openPanel
    : null
  const mobileSheetDescription =
    locale === 'en'
      ? 'Browse filters, title list, and point details'
      : locale === 'ja'
        ? '絞り込み、作品一覧、スポット詳細を表示'
        : '浏览筛选、作品列表与地标详情'

  const detailPanelInner = detail ? (
    <DetailPanel
      label={label}
      detail={detail}
      detailCardMode={detailCardMode}
      selectedPoint={selectedPoint}
      selectedPointState={selectedPointState}
      selectedPointDistanceMeters={selectedPointDistanceMeters}
      selectedPointPanoramaAvailable={Boolean(selectedPointPanoramaAvailable)}
      detailLoading={detailLoading}
      workDetailExpanded={workDetailExpanded}
      quickPilgrimageProgress={quickPilgrimageProgress}
      viewFilter={viewFilter}
      stateFilter={stateFilter}
      detailPoints={detailPoints}
      selectedPointImage={renderPointImage(
        selectedPointImage.previewUrl,
        selectedPoint?.name || '',
        selectedPointImage.downloadUrl,
        true
      )}
      showWantToGoAction={showWantToGoAction}
      checkedInSelectedPoint={Boolean(
        meState?.pointStates.find((ps: any) => ps.pointId === selectedPoint?.id && ps.state === 'checked_in')
      )}
      formatDistance={formatDistance}
      geoHref={selectedPoint ? geoLink(selectedPoint) : null}
      onCloseWorkDetail={() => clearActiveBangumiSelection()}
      onSwitchToBangumiDetail={switchToBangumiDetail}
      onToggleWorkDetailExpanded={() => setWorkDetailExpanded((prev: boolean) => !prev)}
      onShowQuickPilgrimage={() => setShowQuickPilgrimage(true)}
      onChangeViewFilter={setViewFilter}
      onToggleStateFilter={(state: string) => {
        setStateFilter((prev: string[]) =>
          prev.includes(state)
            ? prev.filter((value) => value !== state)
            : [...prev, state]
        )
      }}
      onSelectPoint={(point: any) => {
        setDetailCardMode('point')
        setSelectedPointId(point.id)
        if (!isDesktopRef.current) setMobilePointPopupOpen(false)
        if (mapViewMode === 'panorama') return
        if (point.geo && mapRef.current) {
          focusGeo(point.geo, Math.max(mapRef.current.getZoom(), 13.5), true)
        }
      }}
      onAddSelectedPointToPool={() => {
        if (selectedPoint) {
          addPointToPointPool(selectedPoint.id).catch(() => null)
        }
      }}
      onShowCheckInCard={() => setShowCheckInCard(true)}
      onEnterPanorama={enterPanorama}
      onAddPointToPool={(pointId: string) => {
        addPointToPointPool(pointId).catch(() => null)
      }}
      getPointState={(pointId: string) =>
        meState?.pointStates.find((ps: any) => ps.pointId === pointId)?.state || 'none'
      }
    />
  ) : null

  const explorerPanelContent = (
    <ExplorerPanelContent
      label={label}
      styleMode={styleMode}
      onToggleStyleMode={() => setStyleMode(styleMode === 'street' ? 'satellite' : 'street')}
      onRandom={onRandom}
      queryInput={queryInput}
      query={query}
      setQueryInput={setQueryInput}
      setQuery={setQuery}
      searchOpen={searchOpen}
      setSearchOpen={setSearchOpen}
      searchResult={searchResult}
      onSubmitQuery={onSubmitQuery}
      selectedCity={selectedCity}
      setSelectedCity={setSelectedCity}
      cities={bootstrap?.facets.cities || []}
      tabs={tabs}
      tab={tab}
      setTab={setTab}
      showNearbyLocationCta={showNearbyLocationCta}
      locating={locating}
      onLocate={onLocate}
      loading={loading}
      hasSearchQuery={hasSearchQuery}
      cards={cards}
      selectedBangumiId={selectedBangumiId}
      onOpenBangumi={(id) => {
        openBangumi(id).catch(() => null)
      }}
      onOpenPoint={(bangumiId, pointId) => {
        openBangumi(bangumiId, pointId).catch(() => null)
      }}
      onHoverCardEnter={handleCardPointerEnter}
      onHoverCardLeave={handleCardPointerLeave}
      formatDistance={formatDistance}
      cardsContainerRef={cardsContainerRef}
      cardsLoadMoreRef={cardsLoadMoreRef}
      loadingMoreCards={loadingMoreCards}
      cardsLoadError={cardsLoadError}
      onRetryLoadMore={() => {
        loadMoreCards().catch(() => null)
      }}
      hasMoreCards={hasMoreCards}
    />
  )

  const mobilePointPopup = !isDesktop && !mobilePanelOpen && mobilePointPopupOpen && selectedPoint && mobilePointPopupAnchor ? (
    <PointPopupCard
      point={selectedPoint}
      anchor={mobilePointPopupAnchor}
      imageUrl={selectedPointImage.previewUrl}
      distanceLabel={selectedPointDistanceMeters != null ? `~${formatDistance(selectedPointDistanceMeters)}` : null}
      googleHref={geoLink(selectedPoint)}
      labels={{
        pointDetail: label.pointDetail,
        workDetail: label.workDetail,
        openInGoogle: label.openInGoogle,
        enterPanorama: label.enterPanorama,
        close: label.close,
      }}
      onShowWorkDetail={() => {
        setDetailCardMode('bangumi')
        setMobilePointPopupOpen(false)
        props.setMobilePanelOpen(true)
        props.setMapViewMode('map')
      }}
      onEnterPanorama={enterPanorama}
      onClose={() => setMobilePointPopupOpen(false)}
      panoramaAvailable={Boolean(selectedPointPanorama)}
      panoramaUnavailableLabel={label.panoramaUnavailable}
    />
  ) : null

  const desktopWindowExcerptOverlay = isDesktop && showWindowExcerptOverlay
    ? (
        <WindowExcerptOverlay
          bangumis={windowExcerptBangumis}
          points={windowExcerptPoints}
          activeBangumiId={selectedBangumiId}
          activePointId={props.selectedPointId}
          onBangumiClick={(bangumiId) => {
            openBangumi(bangumiId).catch(() => null)
          }}
          onPointClick={(bangumiId, pointId) => {
            openBangumi(bangumiId, pointId).catch(() => null)
          }}
        />
      )
    : null

  const mapLoadingIndicator = (
    <MapLoadingProgress
      percent={mergedLoadingPercent}
      visible={mergedLoadingVisible}
      title={mergedLoadingTitle}
      detail={mergedLoadingDetail}
      className="pointer-events-none absolute left-4 top-[max(62px,env(safe-area-inset-top,0px)+42px)] z-30 w-[min(320px,calc(100%-1rem))]"
    />
  )

  const mapModeToggle = mapViewMode === 'map'
    ? <MapModeToggle mode={mapMode} onModeChange={props.setMapMode} />
    : null

  const panoramaContent = (
    <div className={`absolute inset-0 bg-black ${mapViewMode === 'panorama' ? '' : 'hidden'}`}>
      {mapViewMode === 'panorama' ? (
        selectedPointPanorama ? (
          <iframe
            key={`${selectedPointPanorama.provider}:${selectedPointPanorama.src}`}
            title={selectedPoint ? `${selectedPoint.name} panorama` : 'panorama'}
            src={selectedPointPanorama.src}
            className="h-full w-full border-0"
            loading="lazy"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={() => {
              props.setPanoramaError(null)
              props.finishPanoramaProgress()
            }}
            onError={() => {
              props.setPanoramaError(label.panoramaLoadFailed)
              props.failPanoramaProgress()
            }}
          />
        ) : (
          <div className="grid h-full w-full place-items-center px-6 text-center text-sm text-white/85">
            {label.panoramaUnavailable}
          </div>
        )
      ) : null}
      {mapViewMode === 'panorama' && props.panoramaLoading ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <div className="w-64 max-w-[78vw] rounded-2xl border border-white/25 bg-black/55 px-4 py-3 text-center shadow-2xl backdrop-blur-sm">
            <div className="mb-2 inline-flex items-center rounded-full bg-white/15 px-2 py-1 text-[11px] font-semibold text-white/95">
              <span>{label.panoramaLoading}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full border border-white/25 bg-white/15">
              <div
                className="h-full rounded-full bg-gradient-to-r from-brand-300 via-brand-400 to-brand-500 transition-[width] duration-200 ease-out"
                style={{ width: `${props.panoramaProgress}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
      {mapViewMode === 'panorama' && props.panoramaError ? (
        <div className="pointer-events-none absolute inset-x-6 bottom-6 z-20 rounded-md bg-black/60 px-3 py-2 text-center text-xs text-white/90">
          {props.panoramaError}
        </div>
      ) : null}
    </div>
  )

  const topBarLeading = mapViewMode === 'panorama' ? (
    <button
      className="rounded-md bg-white/90 px-3 py-1.5 text-xs text-slate-700 shadow hover:bg-white"
      type="button"
      onClick={props.exitPanorama}
    >
      {label.exitPanorama}
    </button>
  ) : (
    <div className="h-9 w-9" />
  )

  const topBarCenter = showMobileVisualCenter ? (
    <MobileVisualCenterBangumiRow
      bangumis={windowExcerptBangumis}
      activeBangumiId={selectedBangumiId}
      onBangumiClick={(bangumiId) => {
        openBangumi(bangumiId).catch(() => null)
      }}
    />
  ) : (
    <div className="flex-1" />
  )

  const topBarActions = (
    <>
      {mapViewMode === 'map' ? (
        <button
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          onClick={onLocate}
          disabled={locating}
          title={locating ? label.locating : label.locate}
          aria-label={locating ? label.locating : label.locate}
        >
          {locating ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m12.5 0a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      ) : null}
      <button className="rounded-md bg-white/90 px-3 py-1.5 text-xs text-slate-700 shadow hover:bg-white" type="button" onClick={props.onShare}>
        {label.share}
      </button>
    </>
  )

  const mobileVisualCenterOverlay = showMobileVisualCenter ? (
    <MobileVisualCenterPointStrip
      points={windowExcerptPoints}
      activePointId={props.selectedPointId}
      onPointClick={(bangumiId, pointId) => {
        openBangumi(bangumiId, pointId, { keepMobilePointPopup: true }).catch(() => null)
      }}
    />
  ) : null

  return (
    <MapShell
      warmupOverlay={null}
      isDesktop={isDesktop}
      explorerPanelContent={explorerPanelContent}
      detailPanelInner={detailPanelInner}
      mapRootRef={props.mapRootRef}
      isMapView={mapViewMode === 'map'}
      mapLoadingIndicator={mapLoadingIndicator}
      mapModeToggle={mapModeToggle}
      panoramaContent={panoramaContent}
      topBarLeading={topBarLeading}
      topBarCenter={topBarCenter}
      topBarActions={topBarActions}
      locateHint={locateHint}
      desktopWindowExcerptOverlay={desktopWindowExcerptOverlay}
      mobileVisualCenterOverlay={mobileVisualCenterOverlay}
      mobilePointPopup={mobilePointPopup}
      mobilePanelButtonLabel={mobilePanelButtonLabel}
      onOpenMobilePanel={() => props.setMobilePanelOpen(true)}
      mobilePanelOpen={mobilePanelOpen}
      setMobilePanelOpen={props.setMobilePanelOpen}
      panelTitle={label.panel}
      hidePanelLabel={label.hidePanel}
      mobileSheetDescription={mobileSheetDescription}
    >
      <MapDialogs
        locale={locale as SupportedLocale}
        label={label}
        detail={detail as AnitabiBangumiDTO | null}
        selectedPoint={selectedPoint}
        showQuickPilgrimage={showQuickPilgrimage}
        quickPilgrimageStates={quickPilgrimageStates}
        setShowQuickPilgrimage={setShowQuickPilgrimage}
        onQuickPilgrimageStatesUpdated={() => {
          loadMe().catch(() => null)
        }}
        routeBookPickerOpen={routeBookPickerOpen}
        setRouteBookPickerOpen={setRouteBookPickerOpen}
        routeBookPickerLoading={routeBookPickerLoading}
        routeBookItems={routeBookItems}
        routeBookPickerSaving={routeBookPickerSaving}
        addSelectedPointToRouteBook={addSelectedPointToRouteBook}
        routeBookTitleDraft={routeBookTitleDraft}
        setRouteBookTitleDraft={setRouteBookTitleDraft}
        createRouteBookAndAddPoint={createRouteBookAndAddPoint}
        routeBookPickerError={routeBookPickerError}
        imagePreview={imagePreview}
        onImagePreviewOpenChange={onImagePreviewOpenChange}
        imageSaving={imageSaving}
        saveOriginalImage={saveOriginalImage}
        imageSaveError={imageSaveError}
        showCheckInCard={showCheckInCard}
        setShowCheckInCard={setShowCheckInCard}
        showRouteBookCard={showRouteBookCard}
        setShowRouteBookCard={setShowRouteBookCard}
        showComparisonGenerator={showComparisonGenerator}
        setShowComparisonGenerator={setShowComparisonGenerator}
        comparisonImageUrl={comparisonImageUrl}
        selectedPointImagePreviewUrl={selectedPointImage.previewUrl}
        selectedPointImageDownloadUrl={selectedPointImage.downloadUrl}
        totalRouteDistance={totalRouteDistance}
        routeBookPoints={(detail?.points || [])
          .filter((point: any): point is typeof point & { geo: [number, number] } =>
            isValidGeoPair(point.geo)
          )
          .map((point: any) => ({ lat: point.geo[0], lng: point.geo[1] }))}
        checkedInThumbnails={checkedInThumbnails}
        onComparisonSuccess={(blob) => {
          setComparisonImageBlob(blob)
          setComparisonImageUrl(URL.createObjectURL(blob))
          setShowComparisonGenerator(false)
          setShowCheckInCard(true)
        }}
        locationDialogOpen={locationDialogOpen}
        setLocationDialogOpen={setLocationDialogOpen}
        onLocationDialogGrant={() => {
          setLocationDialogOpen(false)
          locateUser()
          setTab('nearby' as AnitabiMapTab)
        }}
      />
    </MapShell>
  )
}
