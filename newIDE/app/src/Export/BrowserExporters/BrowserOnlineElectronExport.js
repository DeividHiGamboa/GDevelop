// @flow
import * as React from 'react';
import { Trans } from '@lingui/macro';
import assignIn from 'lodash/assignIn';
import {
  type Build,
  buildElectron,
  uploadBuildFile,
} from '../../Utils/GDevelopServices/Build';
import { type UserProfile } from '../../Profile/UserProfileContext';
import { findGDJS } from './BrowserS3GDJSFinder';
import BrowserFileSystem from './BrowserFileSystem';
import {
  type UrlFileDescriptor,
  type TextFileDescriptor,
  type BlobFileDescriptor,
  downloadUrlsToBlobs,
  archiveFiles,
} from '../../Utils/BrowserArchiver';
import {
  type ExportPipeline,
  type ExportPipelineContext,
} from '../ExportPipeline.flow';
import {
  type ExportState,
  SetupExportHeader,
} from '../GenericExporters/OnlineElectronExport';
const gd = global.gd;

type PreparedExporter = {|
  exporter: gdjsExporter,
  abstractFileSystem: BrowserFileSystem,
  outputDir: string,
|};

type ExportOutput = {|
  textFiles: Array<TextFileDescriptor>,
  urlFiles: Array<UrlFileDescriptor>,
|};

type ResourcesDownloadOutput = {|
  textFiles: Array<TextFileDescriptor>,
  blobFiles: Array<BlobFileDescriptor>,
|};

type CompressionOutput = Blob;

export const browserOnlineElectronExportPipeline: ExportPipeline<
  ExportState,
  PreparedExporter,
  ExportOutput,
  ResourcesDownloadOutput,
  CompressionOutput
> = {
  name: 'browser-online-electron',
  onlineBuildType: 'electron-build',

  getInitialExportState: () => ({
    targets: ['winExe'],
  }),

  canLaunchBuild: (exportState: ExportState) => !!exportState.targets.length,

  renderHeader: props => <SetupExportHeader {...props} />,

  renderLaunchButtonLabel: () => <Trans>Package</Trans>,

  prepareExporter: (
    context: ExportPipelineContext<ExportState>
  ): Promise<PreparedExporter> => {
    return findGDJS('electron').then(({ gdjsRoot, filesContent }) => {
      console.info('GDJS found in ', gdjsRoot);

      const outputDir = '/export/';
      const abstractFileSystem = new BrowserFileSystem({
        textFiles: filesContent,
      });
      const fileSystem = assignIn(
        new gd.AbstractFileSystemJS(),
        abstractFileSystem
      );
      const exporter = new gd.Exporter(fileSystem, gdjsRoot);

      return {
        exporter,
        outputDir,
        abstractFileSystem,
      };
    });
  },

  launchExport: (
    context: ExportPipelineContext<ExportState>,
    { exporter, outputDir, abstractFileSystem }: PreparedExporter
  ): Promise<ExportOutput> => {
    const { project } = context;

    const exportOptions = new gd.MapStringBoolean();
    exportOptions.set('exportForElectron', true);
    exporter.exportWholePixiProject(project, outputDir, exportOptions);
    exportOptions.delete();
    exporter.delete();

    return Promise.resolve({
      textFiles: abstractFileSystem.getAllTextFilesIn(outputDir),
      urlFiles: abstractFileSystem.getAllUrlFilesIn(outputDir),
    });
  },

  launchResourcesDownload: (
    context: ExportPipelineContext<ExportState>,
    { textFiles, urlFiles }: ExportOutput
  ): Promise<ResourcesDownloadOutput> => {
    return downloadUrlsToBlobs({
      urlFiles,
      onProgress: context.updateStepProgress,
    }).then(blobFiles => ({
      blobFiles,
      textFiles,
    }));
  },

  launchCompression: (
    context: ExportPipelineContext<ExportState>,
    { textFiles, blobFiles }: ResourcesDownloadOutput
  ): Promise<Blob> => {
    return archiveFiles({
      blobFiles,
      textFiles,
      basePath: '/export/',
      onProgress: context.updateStepProgress,
    });
  },

  launchUpload: (
    context: ExportPipelineContext<ExportState>,
    blobFile: Blob
  ): Promise<string> => {
    return uploadBuildFile(blobFile, context.updateStepProgress);
  },

  launchOnlineBuild: (
    exportState: ExportState,
    userProfile: UserProfile,
    uploadBucketKey: string
  ): Promise<Build> => {
    const { getAuthorizationHeader, profile } = userProfile;
    if (!profile) return Promise.reject(new Error('User is not authenticated'));

    return buildElectron(
      getAuthorizationHeader,
      profile.uid,
      uploadBucketKey,
      exportState.targets
    );
  },
};
