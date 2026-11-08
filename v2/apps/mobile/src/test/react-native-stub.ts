/**
 * Minimalna zamjena za `react-native` u vitest-u (node okruženje).
 *
 * Pravi `react-native` je pisan u Flow-u i node parser ga ne može pročitati, a paket nema
 * render testove — pa se testovi koji provjeravaju STILOVE (a ne renderovanje) vežu na ovaj stub.
 * Ovdje je samo ono što `src/lib/styles.ts` traži; ništa se ne renderuje.
 */
export const StyleSheet = {
  flatten<T>(style: T): T {
    if (Array.isArray(style)) {
      return Object.assign({}, ...style.flat(Infinity).filter(Boolean)) as T;
    }
    return (style ?? {}) as T;
  },
};
