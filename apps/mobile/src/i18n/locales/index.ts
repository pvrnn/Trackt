import enJson from './en.json';
import frJson from './fr.json';
import discoverEn from './fragments/discover.en.json';
import discoverFr from './fragments/discover.fr.json';
import feedbackEn from './fragments/feedback.en.json';
import feedbackFr from './fragments/feedback.fr.json';
import historyEn from './fragments/history.en.json';
import historyFr from './fragments/history.fr.json';
import homeEn from './fragments/home.en.json';
import homeFr from './fragments/home.fr.json';
import listsEn from './fragments/lists.en.json';
import listsFr from './fragments/lists.fr.json';
import mediaEn from './fragments/media.en.json';
import mediaFr from './fragments/media.fr.json';
import newsEn from './fragments/news.en.json';
import newsFr from './fragments/news.fr.json';
import profileEn from './fragments/profile.en.json';
import profileFr from './fragments/profile.fr.json';
import socialEn from './fragments/social.en.json';
import socialFr from './fragments/social.fr.json';

/**
 * One file per surface so a surface can be converted without editing a
 * thousand-line catalog, and so two people can work on two surfaces at once.
 * The merge is static (object spread, not a runtime loop) so `typeof en` keeps
 * its exact keys for i18next's typed `t()`.
 */
export const en = {
  ...enJson,
  discover: discoverEn,
  media: mediaEn,
  home: homeEn,
  history: historyEn,
  lists: listsEn,
  profile: profileEn,
  social: socialEn,
  news: newsEn,
  feedback: feedbackEn,
};

/**
 * `fr` is checked against the shape of `en`: a missing key is a type error, not
 * an English string on a French screen. Extra French keys are not caught: an
 * unused key costs bytes, a missing one costs a bug.
 */
type Catalog<T> = { [K in keyof T]: T[K] extends string ? string : Catalog<T[K]> };

export const fr: Catalog<typeof en> = {
  ...frJson,
  discover: discoverFr,
  media: mediaFr,
  home: homeFr,
  history: historyFr,
  lists: listsFr,
  profile: profileFr,
  social: socialFr,
  news: newsFr,
  feedback: feedbackFr,
};
