// Prints the app's /#p= link for a pubkey (and relay hints), on the local server.
import { profileLink } from "../../../../../../lib/profile/profile-link.ts"
const [pubkey, ...relays] = process.argv.slice(2)
console.log(profileLink(process.env.BASE ?? "http://localhost:3311", pubkey, relays))
