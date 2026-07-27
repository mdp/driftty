export type ViewerFormFactor = 'desktop' | 'mobile';
export type ViewerOS = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'other';

export interface ViewerProfile {
  formFactor: ViewerFormFactor;
  os: ViewerOS;
  touch: boolean;
  finePointer: boolean;
}
interface NavigatorLike {
  userAgent?: string;
  maxTouchPoints?: number;
}

export function detectViewerProfile(
  navigatorLike: NavigatorLike = typeof navigator === 'undefined' ? {} : navigator,
  finePointer = typeof matchMedia !== 'undefined'
    ? matchMedia('(any-pointer: fine)').matches
    : false,
): ViewerProfile {
  const userAgent = navigatorLike.userAgent ?? '';
  const touch = (navigatorLike.maxTouchPoints ?? 0) > 0;
  const ipadOS = /Macintosh/i.test(userAgent) && touch && !finePointer;
  const ios = /iPad|iPhone|iPod/i.test(userAgent) || ipadOS;
  const android = /Android/i.test(userAgent);
  const mobileUserAgent = /Mobi|Mobile/i.test(userAgent);
  const formFactor: ViewerFormFactor =
    ios || android || (mobileUserAgent && !finePointer) ? 'mobile' : 'desktop';

  let os: ViewerOS = 'other';
  if (ios) os = 'ios';
  else if (android) os = 'android';
  else if (/Windows/i.test(userAgent)) os = 'windows';
  else if (/Macintosh|Mac OS X/i.test(userAgent)) os = 'macos';
  else if (/Linux|X11/i.test(userAgent)) os = 'linux';

  return {formFactor, os, touch, finePointer};
}
