// ==========================================
// SEED DATA — AUSTIN / BARTON CREEK DEMO
// ==========================================
// All figures below are prototype placeholders for interface
// demonstration only. Nothing here is live, verified, scientifically
// authoritative, or legally binding.

/**
 * The demonstration commons.
 *
 * Declared here, once, because four files need to ask "is this the example
 * data?" — the weekly card, the printed sheet, the GeoJSON export and a KOI
 * bundle — and four copies of a string literal is how one of them ends up
 * disagreeing with the rest after a rename.
 *
 * It matters because this seed reads like real reporting. "Unpermitted
 * Stormwater Outfall Discharge", severity Critical, naming a real creek and a
 * real city department, with an author attached. Inside the app that sits under
 * an example-data banner. In an artifact that has travelled — a GeoJSON opened
 * in QGIS, a bundle landed in somebody else's commons — there is no banner, no
 * interface and nobody who knows where the file came from.
 */
export const DEMO_CHAPTER_ID = 'barton-creek';

/**
 * TWO claims, kept apart, because they are not the same claim.
 *
 * The first version of this said "nothing here is a real observation". That was
 * false, and backwards: a GeoJSON of the example commons carries 66 live USGS
 * gage readings and a live NOAA heat advisory — 67 of its 73 features are real
 * data about a real creek. Six are invented. The blanket denial also
 * contradicted the attribution block sitting beside it in the same object,
 * which correctly credits NOAA and USGS.
 *
 * A marker that tells a reader to distrust the authoritative half is worse than
 * no marker, because a wrong claim travels as confidently as a right one — and
 * a hazard alert is the last thing to teach somebody to doubt.
 *
 * The commons is fiction. The land underneath it is not.
 */
export const DEMO_NOTICE = Object.freeze({
  label: 'DEMONSTRATION DATA',
  commons:
    'The chapter, its members, projects, decisions, gatherings and hand-written observations ' +
    'are invented — a fictional commons used to show how this works. No person, group or ' +
    'decision named here exists.',
  land:
    'The readings are not invented. Gage heights, discharge, hazard alerts, soil, land cover ' +
    'and species counts come live from the public sources named in the attribution, and are ' +
    'real measurements of a real place. Treat them as you would from any other copy.',
});

/** True only for the seeded example commons. A notice on everything is noise. */
export const isDemoChapter = (chapterId) => chapterId === DEMO_CHAPTER_ID;

export const INITIAL_PLACES = [
  {
    id: 'place-1',
    name: 'Barton Creek Greenbelt Reach',
    region: 'Austin, Texas — Central Zilker',
    watershed: 'Barton Creek Watershed',
    bioregion: 'Edwards Plateau / Texas Hill Country',
    ecoregion: 'Balcones Canyonlands',
    lat: 30.2610,
    lng: -97.7940,
    description: 'A limestone spring-fed creek corridor running through the Greenbelt into Barton Springs, supporting recreation, karst aquifer recharge, and cypress riparian habitat.',
    healthScore: 74,
    activeSignals: 2,
    activeQuests: 1,
    activeGatherings: 1,
  },
  {
    id: 'place-2',
    name: 'Lower Colorado River Eastside Commons',
    region: 'Austin, Texas — East Riverside',
    watershed: 'Colorado River (Austin reach)',
    bioregion: 'Blackland Prairie Transition Zone',
    ecoregion: 'Texas Blackland Prairies',
    lat: 30.2450,
    lng: -97.7150,
    description: 'Urban riverside floodplain near Roy G. Guerrero Park integrating wetland recovery, pecan bottomland restoration, and a neighborhood tool commons.',
    healthScore: 61,
    activeSignals: 1,
    activeQuests: 1,
    activeGatherings: 1,
  },
];

export const INITIAL_HUBS = [
  {
    id: 'hub-1',
    name: 'Barton Creek Greenbelt Stewardship Hub',
    type: 'Stewardship Hub',
    lat: 30.2632,
    lng: -97.7975,
    placeId: 'place-1',
    description: 'Coordination node for creek monitoring, erosion control, and Greenbelt trail stewardship.',
    stewardsCount: 37,
  },
  {
    id: 'hub-2',
    name: 'Riverside Civic Commons',
    type: 'Civic Commons',
    lat: 30.2438,
    lng: -97.7175,
    placeId: 'place-2',
    description: 'Tool library, native seed bank, and neighborhood resilience assembly space near Roy G. Guerrero Park.',
    stewardsCount: 64,
  },
];

export const INITIAL_SIGNALS = [
  {
    id: 'sig-1',
    title: 'Twin Falls Bank Erosion Scarring',
    category: 'Hydrological',
    severity: 'Watch',
    placeId: 'place-1',
    locationName: 'Twin Falls, Barton Creek Greenbelt',
    lat: 30.2668,
    lng: -97.8105,
    timestamp: '2 hours ago',
    author: 'M. Vance (Field Observer)',
    description: 'Recent flash flooding widened an existing scarp near Twin Falls. Exposed root systems on bald cypress visible along the north bank.',
    verified: true,
    relatedQuestId: 'quest-1',
  },
  {
    id: 'sig-2',
    title: 'Volunteer Pecan Sapling Grove Establishing',
    category: 'Ecological',
    severity: 'Info',
    placeId: 'place-2',
    locationName: 'Roy G. Guerrero floodplain terrace',
    lat: 30.2462,
    lng: -97.7138,
    timestamp: '1 day ago',
    author: 'S. Chen',
    description: 'Community-planted pecan and cedar elm saplings from last season show strong survival. Ready for mulch renewal and ligustrum clearance around the drip line.',
    verified: true,
    relatedQuestId: 'quest-2',
  },
  {
    id: 'sig-3',
    title: 'Unpermitted Stormwater Outfall Discharge',
    category: 'Disturbance',
    severity: 'Critical',
    placeId: 'place-2',
    locationName: 'Outfall near Pleasant Valley Rd crossing',
    lat: 30.2409,
    lng: -97.7201,
    timestamp: '3 days ago',
    author: 'Watershed Ranger Guild',
    description: 'Turbid discharge observed outside of normal storm event timing. Coordination with the City of Austin Watershed Protection Department is needed before any Commons action.',
    verified: true,
  },
];

export const INITIAL_QUESTS = [
  {
    id: 'quest-1',
    title: 'Twin Falls Bank Stabilization & Native Grass Seeding',
    category: 'Restoration',
    status: 'Open',
    placeId: 'place-1',
    locationName: 'Twin Falls, Barton Creek Greenbelt',
    lat: 30.2668,
    lng: -97.8105,
    reward: '15 Eco-Credits + Seed Share Voucher',
    description: 'Install jute matting and seed exposed banks with native little bluestem and switchgrass to slow further scarp erosion above the falls.',
    objectives: [
      'Assess scarp extent and root exposure',
      'Install biodegradable jute matting',
      'Broadcast native grass seed mix',
      'Log bank profile before and after',
    ],
    participantsCount: 6,
    coordinator: 'Barton Creek Watershed Council',
    signalId: 'sig-1',
  },
  {
    id: 'quest-2',
    title: 'Pecan Grove Understory Restoration & Ligustrum Removal',
    category: 'Restoration',
    status: 'In Progress',
    placeId: 'place-2',
    locationName: 'Roy G. Guerrero floodplain terrace',
    lat: 30.2462,
    lng: -97.7138,
    reward: '10 Eco-Credits + Lunch Provided',
    description: 'Clear invasive ligustrum from around the young pecan grove and refresh mulch rings ahead of the summer heat.',
    objectives: [
      'Cut and haul invasive ligustrum',
      'Refresh mulch rings on all saplings',
      'Water-stake for late-summer establishment',
    ],
    participantsCount: 11,
    coordinator: 'Riverside Commons Guild',
    signalId: 'sig-2',
  },
];

export const INITIAL_DECISIONS = [
  {
    id: 'dec-1',
    title: 'Barton Creek Summer Low-Flow Recreation & Access Accord',
    proposal: 'Establish a voluntary rotating closure of the Twin Falls access trail on Tuesday and Wednesday mornings during August low-flow conditions, to let disturbed banks stabilize, with clear signage and an alternate swim-access point.',
    author: 'Barton Creek Watershed Working Group',
    placeId: 'place-1',
    status: 'Needs Revision',
    authorityScope: 'Watershed Working Group',
    governs: [
      'Signage and volunteer trail-monitoring at Twin Falls',
      'Commons-coordinated restoration work windows',
      'Voluntary visitor advisories posted by participating stewards',
    ],
    outsideAuthority: [
      'City of Austin Parks and Recreation trail access rules',
      'Texas Parks and Wildlife regulations',
      'Private property adjacent to the Greenbelt',
    ],
    objections: [
      {
        id: 'obj-1',
        author: 'J. Miller (Greenbelt Running Club)',
        text: 'A Tuesday/Wednesday closure conflicts with our long-standing weekday group run schedule without an alternate route being proposed.',
        timestamp: '1 day ago',
        status: 'Active',
      },
    ],
    reviewDate: '2026-09-15',
    createdAt: '2026-08-01',
    votes: { consent: 8, concern: 3, objection: 1, needInfo: 2 },
  },
  {
    id: 'dec-2',
    title: 'Riverside Commons Tool Library & Equipment Sharing Protocol v2',
    proposal: 'Adopt shared guidelines for community tool lending at the Riverside Civic Commons, including maintenance deposits, 14-day max loan periods, and a volunteer repair Saturday.',
    author: 'Riverside Commons Guild',
    placeId: 'place-2',
    status: 'Consented',
    authorityScope: 'Community Commons',
    governs: [
      'All physical tools housed in the Riverside Commons shed',
      'Equipment checkout and return logs',
      'Volunteer repair shift allocations',
    ],
    outsideAuthority: [
      'Privately owned tools stored in personal residences',
      'Commercial equipment rental agencies',
      'City of Austin park-use permits',
    ],
    objections: [],
    reviewDate: '2026-12-01',
    createdAt: '2026-07-15',
    votes: { consent: 19, concern: 1, objection: 0, needInfo: 0 },
  },
];

export const INITIAL_GATHERINGS = [
  {
    id: 'gat-1',
    title: 'Barton Creek Autumn Watershed Assembly',
    type: 'Watershed Circle',
    date: '2026-08-28',
    time: '10:00 AM - 2:00 PM',
    locationName: 'Barton Creek Greenbelt Stewardship Hub',
    placeId: 'place-1',
    lat: 30.2632,
    lng: -97.7975,
    organizer: 'Barton Creek Watershed Council',
    description: 'Quarterly assembly to review summer creek health, discuss the low-flow access accord, and coordinate autumn bank-stabilization work.',
    rsvpsCount: 24,
    isRsvp: true,
    decisionIds: ['dec-1'],
    relatedSignalIds: ['sig-1'],
    relatedQuestIds: ['quest-1'],
  },
  {
    id: 'gat-2',
    title: 'Riverside Commons Design Jam & Tool Share',
    type: 'Design Jam',
    date: '2026-09-02',
    time: '2:00 PM - 5:00 PM',
    locationName: 'Riverside Civic Commons',
    placeId: 'place-2',
    lat: 30.2438,
    lng: -97.7175,
    organizer: 'Riverside Commons Guild',
    description: 'Working meetup to test the tool-sharing protocol and lay out the next pecan grove planting phase.',
    rsvpsCount: 18,
    isRsvp: false,
    decisionIds: ['dec-2'],
    relatedSignalIds: ['sig-2'],
    relatedQuestIds: ['quest-2'],
  },
];

export const INITIAL_EXCHANGE = [
  {
    id: 'ex-1',
    title: 'Heavy-Duty Post Hole Digger & Tamping Bar',
    category: 'Tools & Equipment',
    type: 'Offering',
    location: 'Barton Creek Greenbelt Hub',
    author: 'Mark V.',
    description: 'Available for weekend bank-stabilization or fencing projects. Sturdy steel construction.',
    contact: 'mark.v@greenfire.civic',
    timestamp: '2 days ago',
  },
  {
    id: 'ex-2',
    title: 'Bald Cypress (Taxodium distichum) Live Stakes',
    category: 'Seeds & Starts',
    type: 'Offering',
    location: 'Riverside Civic Commons',
    author: 'Sarah C.',
    description: 'Bundle of 40 fresh-cut stakes harvested from a sustainably managed donor tree along Barton Creek. Good rooting vigor.',
    contact: 'sarah.c@greenfire.civic',
    timestamp: '4 days ago',
  },
];

export const INITIAL_LEARN = [
  {
    id: 'learn-1',
    title: 'Consent-Based Governance in Practice',
    category: 'Consent-Based Governance',
    readTime: '6 min read',
    summary: 'Understanding the distinction between consensus and consent: moving forward when proposals are safe enough to try and clear enough to review.',
    content: 'Consent-based governance replaces majority-rule voting with structured objection processing. Instead of asking "Do you love this proposal?", the guiding question is "Is this safe enough to try and clear enough to review?" Objections must be reasoned, specific, and aimed at preventing harm, transforming opposition into constructive proposal refinement.',
  },
  {
    id: 'learn-2',
    title: 'Watershed Literacy & Nested Scales',
    category: 'Watershed Literacy',
    readTime: '8 min read',
    summary: 'How to read ecological boundaries from a spring-fed creek to a continental bioregion, using Barton Creek and the Colorado River as a working example.',
    content: 'Political boundaries often slice across watersheds, creating fragmented governance challenges. Barton Creek drains through Austin\'s Greenbelt into the Colorado River, which itself sits within the wider Edwards Plateau and Blackland Prairie ecoregions. Watershed literacy teaches us to map decisions to natural water flow, karst aquifer recharge zones, and soil typologies rather than city or county lines alone.',
  },
];

export const INITIAL_FEDERATION = [
  {
    id: 'fed-1',
    name: 'Hill Country Bioregional Network',
    bioregion: 'Edwards Plateau / Texas Hill Country',
    status: 'Connected',
    sharedProtocols: 14,
    lastSync: '12 mins ago',
  },
  {
    id: 'fed-2',
    name: 'Lower Colorado River Commons Alliance',
    bioregion: 'Texas Blackland Prairies / Colorado River Corridor',
    status: 'Connected',
    sharedProtocols: 8,
    lastSync: '1 hour ago',
  },
];
