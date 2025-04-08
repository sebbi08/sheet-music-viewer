declare module "vuex-map-fields" {
  // export function mapFields<V extends { [P in U]: unknown }, U extends keyof V>(
  //   fields: V
  // ): { [P in U]: () => any };

  export function updateField(): unknown;

  export function getField<T>(): T;
}
