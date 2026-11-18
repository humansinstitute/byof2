export const name = 'byofreedom.builderGate.v1';
export const description = 'Fail closed until enforced isolation includes an explicit native publication tool.';
export const version = 1;
export default async function gate(): Promise<Record<string, unknown>> {
  throw Error('Builder activation blocked: supported isolated native runtime has no explicit app publication tool; trusted-host publication runtime has no host filesystem isolation. Manager must resolve and independently verify the supported capability.');
}
