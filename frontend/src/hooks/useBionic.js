import { createContext, useContext } from 'react'

// True when the body font is set to the Bionic Reading mode. Provided at the
// app root from the font setting; consumed by prose surfaces.
export const BionicContext = createContext(false)
export const useBionic = () => useContext(BionicContext)
