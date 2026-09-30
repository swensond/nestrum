import { createAdminComponentRegistry } from '../src/lib/component-registry.js';
import CustomWidget from './CustomWidget.svelte';

export default createAdminComponentRegistry().register('json-editor', CustomWidget).seal();
