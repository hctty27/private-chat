import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  apiGet: vi.fn(),
  put: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: mocks.apiPost,
      get: mocks.apiGet,
      interceptors: {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      },
    })),
    put: mocks.put,
  },
}))

import { uploadFile } from './index'

describe('uploadFile image optimization', () => {
  beforeEach(() => {
    mocks.apiPost.mockReset()
    mocks.put.mockReset()
    mocks.put.mockResolvedValue({ status: 200 })

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 1600,
      height: 1200,
      close: vi.fn(),
    }))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['thumbnail'], { type: 'image/jpeg' }))
    })
  })

  it('uploads a generated thumbnail when the presign response provides a thumbnail target', async () => {
    mocks.apiPost
      .mockResolvedValueOnce({
        data: {
          code: 200,
          data: {
            fileId: 7,
            uploadMode: 'single',
            uploadUrl: 'https://r2.example/original',
            thumbnailUploadUrl: 'https://r2.example/thumbnail',
            url: '/api/files/7/content',
            fileName: 'photo.jpg',
            fileSize: 1024,
            headers: { 'Content-Type': 'image/jpeg' },
            thumbnailHeaders: { 'Content-Type': 'image/jpeg' },
          },
        },
      })
      .mockResolvedValueOnce({ data: { code: 200, data: {} } })

    const file = new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' })

    await uploadFile(file, 2)

    expect(mocks.put).toHaveBeenCalledTimes(2)
    expect(mocks.put.mock.calls[0][0]).toBe('https://r2.example/original')
    expect(mocks.put.mock.calls[1][0]).toBe('https://r2.example/thumbnail')
    expect(mocks.put.mock.calls[1][1]).toBeInstanceOf(Blob)
  })

  it('uploads multipart files in parallel and completes with part ETags', async () => {
    mocks.apiPost
      .mockResolvedValueOnce({
        data: {
          code: 200,
          data: {
            fileId: 9,
            uploadMode: 'multipart',
            uploadId: 'upload-9',
            partSize: 3,
            parts: [
              { partNumber: 1, uploadUrl: 'https://r2.example/part-1' },
              { partNumber: 2, uploadUrl: 'https://r2.example/part-2' },
            ],
            url: '/api/files/9/content',
            fileName: 'archive.zip',
            fileSize: 6,
          },
        },
      })
      .mockResolvedValueOnce({ data: { code: 200, data: { fileId: 9 } } })

    mocks.put
      .mockResolvedValueOnce({ status: 200, headers: { etag: '"etag-1"' } })
      .mockResolvedValueOnce({ status: 200, headers: { etag: '"etag-2"' } })

    const file = new File(['abcdef'], 'archive.zip', { type: 'application/zip' })
    await uploadFile(file, 2)

    expect(mocks.put).toHaveBeenCalledTimes(2)
    expect(mocks.put.mock.calls.map(call => call[0])).toEqual([
      'https://r2.example/part-1',
      'https://r2.example/part-2',
    ])
    expect(mocks.apiPost).toHaveBeenLastCalledWith('/api/files/9/complete', {
      uploadId: 'upload-9',
      parts: [
        { partNumber: 1, etag: 'etag-1' },
        { partNumber: 2, etag: 'etag-2' },
      ],
    }, { signal: undefined })
  })
})
