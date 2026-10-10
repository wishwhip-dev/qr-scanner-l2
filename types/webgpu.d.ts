// WebGPU's ambient types ship as `@webgpu/types`, which lives outside `node_modules/@types` and
// is therefore never picked up automatically the way `@types/node` and `@types/react` are. Without
// this reference `GPUDevice`, `GPUAdapter` and `navigator.gpu` are all unresolved names, and the
// package being present in package.json makes that look like anything but a configuration gap.
//
// One task burned roughly forty steps and 800k tokens on ten TS2304 errors with the package already
// installed, writing scratch files to probe the type system rather than wiring it up. Declaring it
// once here costs every generated app one ambient reference and nothing at runtime.
/// <reference types="@webgpu/types" />
