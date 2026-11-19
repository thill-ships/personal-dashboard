// Public settings for the screens. The publishable key is meant to be public:
// row-level security lets only Tyler's login read or write anything.
export const SUPABASE_URL = 'https://skofdsccrldzswhdxihm.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_WyL4ZPzxQryiHX61-nWYAQ_IuaD0SsJ';

export const TZ = 'America/Denver';

// Commute windows (hours, local): drive in about 7:15 AM, home about 5:30 PM.
export const COMMUTE = { in: 7.25, home: 17.5 };

export const SUNDANCE_WEBCAMS_PAGE = 'https://www.sundanceresort.com/webcams/';

// Goal index: starts at 100; each finished day adds (perfect - miss) * share done + miss,
// so a perfect day is +1.5, a day with nothing done is -0.5 and 5 of 7 is about +0.9.
export const GOAL_INDEX = { start: 100, perfect: 1.5, miss: -0.5 };

// Bedtime: hours of sleep to aim for, and more when this morning's recovery was below normal.
export const SLEEP_GOAL_H = 8;
export const SLEEP_CATCH_UP_H = 8.5;
