export const arrayify = target => target
  ? Array.isArray(target)
    ? target
    : [target]
  : []

export const difference = (A, B) => A.filter(x => !B.includes(x))
