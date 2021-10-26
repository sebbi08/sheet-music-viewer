declare module "vuex-map-fields" {
  export function mapFields<V extends { [P in U]: any }, U extends keyof V>(
    fields: V
  ): { [P in U]: () => any };
  export function updateField(): any;
  export function getField(): any;
}
