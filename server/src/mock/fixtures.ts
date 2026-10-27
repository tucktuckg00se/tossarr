export interface ShowFixture {
  id: number;
  title: string;
  year: number | null;
  overview: string;
  network: string | null;
  runtime: number | null;
  genres: string[];
  posterFile: string | null;
}

export interface MovieFixture {
  id: number;
  title: string;
  year: number | null;
  overview: string;
  runtime: number | null;
  imdbId: number | null;
  genres: string[];
  hasFile: boolean;
  posterFile: string | null;
}

/** ~8 shows; a couple without posters to exercise the SVG fallback. */
export const SONARR_SHOWS: ShowFixture[] = [
  {
    id: 101,
    title: 'The Office',
    year: 2005,
    overview: 'A mockumentary following the employees of a Scranton paper company.',
    network: 'NBC',
    runtime: 22,
    genres: ['Comedy'],
    posterFile: 'show-101.svg',
  },
  {
    id: 102,
    title: 'Breaking Bad',
    year: 2008,
    overview: 'A chemistry teacher turns to manufacturing meth to secure his family’s future.',
    network: 'AMC',
    runtime: 47,
    genres: ['Drama', 'Crime'],
    posterFile: 'show-102.svg',
  },
  {
    id: 103,
    title: 'Fringe',
    year: 2008,
    overview: 'A federal task force investigates unexplained phenomena at the fringes of science.',
    network: 'Fox',
    runtime: 44,
    genres: ['Sci-Fi', 'Drama'],
    posterFile: null,
  },
  {
    id: 104,
    title: 'Community',
    year: 2009,
    overview: 'A slacker and his unlikely study group navigate life at a community college.',
    network: 'NBC',
    runtime: 22,
    genres: ['Comedy'],
    posterFile: 'show-104.svg',
  },
  {
    id: 105,
    title: 'Silicon Valley',
    year: 2014,
    overview: 'A group of young tech founders navigate the startup world.',
    network: 'HBO',
    runtime: 27,
    genres: ['Comedy'],
    posterFile: 'show-105.svg',
  },
  {
    id: 106,
    title: 'The Expanse',
    year: 2017,
    overview: 'In the 23rd century, tensions between Earth, Mars, and the Belt explode.',
    network: 'Syfy',
    runtime: 43,
    genres: ['Sci-Fi', 'Drama'],
    posterFile: null,
  },
  {
    id: 107,
    title: 'Rick and Morty',
    year: 2013,
    overview: 'A mad scientist drags his grandson through chaos across the multiverse.',
    network: 'Adult Swim',
    runtime: 24,
    genres: ['Animation', 'Comedy', 'Sci-Fi'],
    posterFile: 'show-107.svg',
  },
  {
    id: 108,
    title: 'True Detective',
    year: 2014,
    overview: 'Antagonistic detectives hunt a serial killer across decades and states.',
    network: 'HBO',
    runtime: 56,
    genres: ['Crime', 'Drama'],
    posterFile: 'show-108.svg',
  },
];

/** ~10 movies; two without files (filtered by hasFile=true), two without posters. */
export const RADARR_MOVIES: MovieFixture[] = [
  {
    id: 201,
    title: 'The Dark Knight',
    year: 2008,
    overview: 'Batman faces the Joker, a criminal mastermind who wants chaos.',
    runtime: 152,
    imdbId: 1853728,
    genres: ['Action', 'Crime', 'Drama'],
    hasFile: true,
    posterFile: 'movie-201.svg',
  },
  {
    id: 202,
    title: 'Spirited Away',
    year: 2001,
    overview: 'A girl wanders into a world of spirits and must free her parents.',
    runtime: 125,
    imdbId: 129,
    genres: ['Animation', 'Fantasy'],
    hasFile: true,
    posterFile: 'movie-202.svg',
  },
  {
    id: 203,
    title: 'The Grand Budapest Hotel',
    year: 2014,
    overview: 'A legendary concierge and his lobby boy get tangled in a heist.',
    runtime: 99,
    imdbId: 18561,
    genres: ['Comedy', 'Drama'],
    hasFile: true,
    posterFile: null,
  },
  {
    id: 204,
    title: 'Parasite',
    year: 2019,
    overview: 'A poor family schemes its way into a wealthy household.',
    runtime: 132,
    imdbId: 4356420,
    genres: ['Thriller', 'Drama'],
    hasFile: true,
    posterFile: 'movie-204.svg',
  },
  {
    id: 205,
    title: 'Whiplash',
    year: 2014,
    overview: 'A young drummer pushes himself to greatness under a ruthless instructor.',
    runtime: 106,
    imdbId: 2106476,
    genres: ['Drama', 'Music'],
    hasFile: true,
    posterFile: 'movie-205.svg',
  },
  {
    id: 206,
    title: 'Arrival',
    year: 2016,
    overview: 'A linguist races to decode the language of alien visitors.',
    runtime: 116,
    imdbId: 2720888,
    genres: ['Sci-Fi', 'Drama'],
    hasFile: true,
    posterFile: 'movie-206.svg',
  },
  {
    id: 207,
    title: 'Mad Max: Fury Road',
    year: 2015,
    overview: 'A warrior and a rebel flee a tyrant across the wasteland.',
    runtime: 120,
    imdbId: 1425092,
    genres: ['Action', 'Adventure'],
    hasFile: true,
    posterFile: 'movie-207.svg',
  },
  {
    id: 208,
    title: 'Her',
    year: 2013,
    overview: 'A lonely man falls in love with his operating system.',
    runtime: 126,
    imdbId: 1462024,
    genres: ['Romance', 'Sci-Fi'],
    hasFile: true,
    posterFile: null,
  },
  {
    id: 209,
    title: 'The Prestige',
    year: 2006,
    overview: 'Two rival magicians spiral into obsession and deception.',
    runtime: 130,
    imdbId: 8841,
    genres: ['Drama', 'Mystery'],
    hasFile: false,
    posterFile: null,
  },
  {
    id: 210,
    title: 'Get Out',
    year: 2017,
    overview: 'A young man visits his girlfriend’s family and uncovers a sinister secret.',
    runtime: 104,
    imdbId: 3619552,
    genres: ['Horror', 'Thriller'],
    hasFile: false,
    posterFile: null,
  },
];
