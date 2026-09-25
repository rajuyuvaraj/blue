const { describe, it } = require('node:test');
const assert = require('node:assert');
const playlist = require('../public/js/songs');

// Standalone implementation of Player logic for unit testing
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class PlayerEngine {
  constructor(initialPlaylist = playlist) {
    this.playlist = [...initialPlaylist];
    this.queue = [];
    this.currentIndex = 0;
    this.historyStack = [];
    this.justRestarted = false;
    this.currentTrackPosition = 0;
    this.currentSong = null;
    this.initQueue();
  }

  initQueue() {
    this.queue = shuffleArray(this.playlist);
    this.currentIndex = 0;
    this.currentSong = this.queue[0];
  }

  playNext() {
    if (!this.queue.length) return;
    const currentSong = this.queue[this.currentIndex];
    if (currentSong) {
      this.historyStack.push(currentSong);
    }

    if (this.currentIndex + 1 >= this.queue.length) {
      this.queue = shuffleArray(this.queue);
      this.currentIndex = 0;
    } else {
      this.currentIndex++;
    }

    this.justRestarted = false;
    this.currentSong = this.queue[this.currentIndex];
    this.currentTrackPosition = 0;
  }

  playPrevious() {
    if (!this.queue.length) return 'none';

    if (!this.justRestarted) {
      // Stage 1: Restart current track
      this.currentTrackPosition = 0;
      this.justRestarted = true;
      return 'restarted';
    } else {
      // Stage 2: Go to previous song in session history
      if (this.historyStack.length > 0) {
        const prev = this.historyStack.pop();
        const foundIdx = this.queue.findIndex((s) => s.videoId === prev.videoId);
        if (foundIdx !== -1) {
          this.currentIndex = foundIdx;
        }
        this.justRestarted = false;
        this.currentSong = prev;
        this.currentTrackPosition = 0;
        return 'previous';
      } else {
        this.currentTrackPosition = 0;
        return 'first_track';
      }
    }
  }
}

describe('Player Logic & Playlist Suite', () => {
  it('should have 100 curated tracks with valid video IDs', () => {
    assert.strictEqual(playlist.length, 100);
    playlist.forEach((song) => {
      assert.ok(song.videoId, 'Track missing videoId');
      assert.ok(song.title, 'Track missing title');
    });
  });

  it('shuffle should produce the same elements in a different order', () => {
    const original = playlist.map((s) => s.videoId);
    const shuffled = shuffleArray(playlist).map((s) => s.videoId);

    // Elements should match as a set/sorted array
    assert.strictEqual(shuffled.length, original.length);
    assert.deepStrictEqual([...shuffled].sort(), [...original].sort());

    // Order should differ with extremely high probability
    const matchesOriginalOrder = shuffled.every((id, idx) => id === original[idx]);
    assert.strictEqual(matchesOriginalOrder, false, 'Shuffled queue should differ from initial order');
  });

  it('should correctly execute two-stage previous logic', () => {
    const player = new PlayerEngine(playlist);

    // Initial state
    assert.strictEqual(player.currentIndex, 0);
    const song1 = player.currentSong;

    // Advance to next track
    player.playNext();
    assert.strictEqual(player.currentIndex, 1);
    const song2 = player.currentSong;
    assert.strictEqual(player.historyStack.length, 1);

    // 1st Previous press: should restart current song
    const stage1Result = player.playPrevious();
    assert.strictEqual(stage1Result, 'restarted');
    assert.strictEqual(player.currentSong.videoId, song2.videoId);
    assert.strictEqual(player.justRestarted, true);

    // 2nd Previous press immediately following: should play previous from history
    const stage2Result = player.playPrevious();
    assert.strictEqual(stage2Result, 'previous');
    assert.strictEqual(player.currentSong.videoId, song1.videoId);
    assert.strictEqual(player.justRestarted, false);
    assert.strictEqual(player.historyStack.length, 0);
  });

  it('should re-shuffle the queue when wrapping past the last index', () => {
    const smallPlaylist = playlist.slice(0, 3);
    const player = new PlayerEngine(smallPlaylist);

    assert.strictEqual(player.queue.length, 3);
    assert.strictEqual(player.currentIndex, 0);

    // Advance track 1 -> 2
    player.playNext();
    assert.strictEqual(player.currentIndex, 1);

    // Advance track 2 -> 3
    player.playNext();
    assert.strictEqual(player.currentIndex, 2);

    const queueBeforeWrap = player.queue.map((s) => s.videoId);

    // Advance past end: should wrap to index 0 and re-shuffle
    player.playNext();
    assert.strictEqual(player.currentIndex, 0);
    assert.strictEqual(player.queue.length, 3);

    const queueAfterWrap = player.queue.map((s) => s.videoId);
    // All original items must still be present
    assert.deepStrictEqual([...queueAfterWrap].sort(), [...queueBeforeWrap].sort());
  });
});
