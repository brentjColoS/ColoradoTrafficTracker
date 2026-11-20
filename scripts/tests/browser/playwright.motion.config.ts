import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Opt-in throttled diagnostics, separate from the normal UI gates.
export default defineConfig({...base,testDir:'./performance',fullyParallel:false,workers:1,retries:0,
  projects:base.projects?.filter(project=>project.name==='chromium')});
