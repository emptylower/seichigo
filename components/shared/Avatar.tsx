export default function Avatar({ src, alt }: { src?: string | null; alt?: string | null }) {
  return (
    <div className="h-8 w-8 overflow-hidden rounded-full border border-pink-200 bg-pink-100">
      {src ? <img src={src} alt={alt || ''} className="h-full w-full object-cover" /> : null}
    </div>
  )
}

