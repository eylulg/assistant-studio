/** Remembers the last result. Selectors take the same arrays and objects again until the data or a filter changes. */
export function memoLast<Args extends readonly unknown[], Result>(
  compute: (...args: Args) => Result,
): (...args: Args) => Result {
  let last: { args: Args; result: Result } | null = null;
  return (...args) => {
    if (
      last &&
      last.args.length === args.length &&
      last.args.every((value, index) => Object.is(value, args[index]))
    )
      return last.result;
    const result = compute(...args);
    last = { args, result };
    return result;
  };
}
