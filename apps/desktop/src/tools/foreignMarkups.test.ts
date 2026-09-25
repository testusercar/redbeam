import { describe, expect, it } from 'vitest'
import {
  hiddenOnPage, hiddenStorageKey, hideAll, hideAnnotation, parseHidden, parseHiddenBook,
  showHidden, visibilityToken, visibleAnnotations,
} from './foreignMarkups.js'

describe('hidden PDF markups', () => {
  it('keys the session by document and never by a path the PDF could be written back to', () => {
    expect(hiddenStorageKey('doc-a')).toBe('redbeam.hidden-annots:doc-a')
  })

  it('builds a stable token so a tile cache can tell two views of one page apart', () => {
    expect(visibilityToken([])).toBe('')
    expect(visibilityToken([4, 1, 4, -1, 1.5])).toBe('1,4')
  })

  it('hides one, hides the sheet, and shows them again', () => {
    expect(hideAnnotation([2], 2)).toEqual([2])
    expect(hideAnnotation([2], 5)).toEqual([2, 5])
    expect(hideAll([3, 1, 3])).toEqual([1, 3])
    expect(showHidden()).toEqual([])
  })

  it('drops a hidden annotation from hit-testing and keeps the rest', () => {
    const list = [{ index: 1, name: 'a' }, { index: 2, name: 'b' }]
    expect(visibleAnnotations(list, new Set([1]))).toEqual([{ index: 2, name: 'b' }])
    expect(visibleAnnotations(list, new Set())).toEqual(list)
  })

  it('reads a stored list and ignores anything that is not one', () => {
    expect(parseHidden(null)).toEqual([])
    expect(parseHidden('nope')).toEqual([])
    expect(parseHidden('[1, "x", 2, -3]')).toEqual([1, 2])
  })

  it('keeps each sheet’s hidden set apart, because annotation indexes restart per page', () => {
    const book = parseHiddenBook('{"0":[1],"2":[4,"x"]}')
    expect(hiddenOnPage(book, 0)).toEqual([1])
    expect(hiddenOnPage(book, 2)).toEqual([4])
    expect(hiddenOnPage(book, 1)).toEqual([])
    expect(parseHiddenBook('[3, 1]')).toEqual({ '0': [3, 1] })
  })
})
