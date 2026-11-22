import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,nextIndex,imageDuration,logicalSize,rotationFilters,videoFilters} from '../shared-types/core.ts';
test('sequencing wraps, handles empty and single-item lists',()=>{assert.equal(nextIndex(-1,3),0);assert.equal(nextIndex(2,3),0);assert.equal(nextIndex(0,1),0);assert.equal(nextIndex(0,0),-1);});
test('image durations default and clamp to valid seconds',()=>{assert.equal(imageDuration(0),10);assert.equal(imageDuration(7.5),7.5);assert.equal(imageDuration(-2),1);assert.equal(imageDuration(999999),86400);});
test('all rotations map clockwise without confusing mirror and 270',()=>{assert.deepEqual(rotationFilters(0),[]);assert.deepEqual(rotationFilters(90),['transpose=clock']);assert.deepEqual(rotationFilters(180),['hflip','vflip']);assert.deepEqual(rotationFilters(270),['transpose=cclock']);});
test('portrait fit is done before rotation into native frame',()=>{for(const rotation of [0,90,180,270] as const){const d={...defaults,rotation};assert.deepEqual(logicalSize(d),rotation===90||rotation===270?[1080,1920]:[1920,1080]);const f=videoFilters(d);assert.ok(f.includes('pad='));if(rotation===90)assert.ok(f.indexOf('pad=')<f.indexOf('transpose='));}assert.ok(videoFilters({...defaults,fit:'cover'}).includes('crop='));assert.ok(!videoFilters({...defaults,fit:'stretch'}).includes('pad='));});
