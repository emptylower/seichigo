import { Fragment } from 'react'
import { TocProps } from './types'
import TocPanel from './TocPanel'

type Props = TocProps & {
  isOpen: boolean
  onClose: () => void
}

export default function TocDrawer({ isOpen, onClose, ...props }: Props) {
  return (
    <div
      className={`fixed inset-0 z-[100] transform transition-all duration-300 ease-in-out ${
        isOpen ? 'visible' : 'invisible pointer-events-none'
      }`}
    >
      <div
        className={`absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      <div
        className={`absolute right-0 top-0 bottom-0 w-[280px] bg-white shadow-2xl transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">目录</h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              <span className="sr-only">关闭</span>
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-4">
            <TocPanel
              {...props}
              onHeadingClick={(h) => {
                props.onHeadingClick(h)
                onClose()
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
