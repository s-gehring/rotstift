export function at<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`Index ${index} liegt außerhalb der Liste.`);
  return item;
}
