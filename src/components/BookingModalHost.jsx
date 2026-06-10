import { useEffect, useState } from 'react'
import BookingModal from './BookingModal.jsx'

// Mounted once in App. Listens for the 'open-booking' event that the CTA
// buttons dispatch (via lib/booking.js) and shows the Form 2 modal.
export default function BookingModalHost() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('open-booking', onOpen)
    return () => window.removeEventListener('open-booking', onOpen)
  }, [])

  if (!open) return null
  return <BookingModal onClose={() => setOpen(false)} />
}
