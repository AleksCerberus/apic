import { ApiProjectState } from 'src/app/state/apiProjects.state';
import { EnvState } from './../../state/envs.state';
import { Env } from './../../models/Envs.model';
import { EnvService } from './../../services/env.service';
import { ApiProjectService } from './../../services/apiProject.service';
import { Toaster } from './../../services/toaster.service';
import { Component, OnInit, Input, EventEmitter, Output } from '@angular/core';
import { ApiProject } from 'src/app/models/ApiProject.model';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import User from 'src/app/models/User';
import { FormGroup, FormBuilder, Validators } from '@angular/forms';
import Utils from '../../utils/helpers'
import { map, take } from 'rxjs/operators';

@Component({
    selector: 'app-project-home',
    templateUrl: './project-home.component.html',
    styleUrls: ['../api-project-detail.component.css']
})
export class ProjectHomeComponent implements OnInit {
    @Input() selectedPROJ: ApiProject;
    @Input() updateApiProject: Function;
    @Input() openExportModal: Function;
    @Output() changeStageEmitter = new EventEmitter<number>();

    projSettingsForm: FormGroup;
    projDetailForm: FormGroup;
    projEnv: Env = null; //auto generated env for this project
    flags = {
        editProj: false
    }

    constructor(
        private store: Store,
        private toaster: Toaster,
        private router: Router,
        fb: FormBuilder,
        private apiProjectService: ApiProjectService,
        private envService: EnvService) {

        console.log('In Project home');

        this.projSettingsForm = fb.group({
            host: ['', Validators.required],
            basePath: [''],
            protocol: ['http']
        });

        this.projDetailForm = fb.group({
            title: ['', Validators.required],
            version: ['', Validators.required],
            description: [''],
            termsOfService: [''],
            license: fb.group({
                name: [''],
                url: ['']
            }),
            contact: fb.group({
                name: [''],
                url: [''],
                email: ['']
            })
        })
    }

    selectProject() {
        // vm.leftTree = {};
        // vm.responses = [];
        this.resetProjInfoEdit();
        if (this.selectedPROJ.setting) {
            this.projSettingsForm.patchValue({ ...this.selectedPROJ.setting });
            this.store.select(EnvState.getById).pipe(map(filterFn => filterFn(this.selectedPROJ.setting.envId)))
                .subscribe(env => { this.projEnv = env });
        }
        // this.selectedPROJEndps = getEndpoints(this.selectedPROJ);
        // generateLeftTree();
        // vm.responses = DesignerServ.getTraitNamedResponses(this.selectedPROJ);
        // //set security definitions
        // vm.securityDefs = this.selectedPROJ.securityDefinitions || [];
        // //reset selection for folders, models, traits and endpoints
        // setCreate();
        // setCreateModel();
        // setCreateTrait();
        // setCreateEndp();

    }

    deleteProj() {
        if (this.selectedPROJ.owner && User.userData && User.userData.UID !== this.selectedPROJ.owner) {
            this.toaster.error('You can\'t delete this Project as you are not the owner. If you have permission you can edit it though.');
            return;
        }
        var id = this.selectedPROJ._id;
        this.apiProjectService.deleteAPIProject(id).then(() => {

            if (this.selectedPROJ.setting && this.selectedPROJ.setting.envId) {
                this.envService.deleteEnv(this.selectedPROJ.setting.envId)
            }

            this.router.navigate(['/designer']);
            this.toaster.success('Project deleted');
        }, () => {
            this.toaster.error('Failed to delete project');
        });
    }

    saveProjSetting() {
        if (!this.projSettingsForm.valid) {
            this.toaster.error('Please enter host name');
            return;
        };
        const settings = this.projSettingsForm.value;
        console.log(this.projSettingsForm)
        //if host has /at the end remove it
        if (settings.host.charAt(settings.host.length - 1) === '/') {
            settings.host = settings.host.substring(0, settings.host.length - 1);
        }

        var ts = new Date().getTime();
        //find existing env for this project if any, based on find add or update
        var action = this.selectedPROJ.setting && this.selectedPROJ.setting.envId ? 'update' : 'add';
        var newEnv: Env = {
            name: this.selectedPROJ.title + '-env',
            vals: [],
            _created: ts,
            _modified: ts,
            _id: this.selectedPROJ.setting && this.selectedPROJ.setting.envId ? this.selectedPROJ.setting.envId : ts + '-' + Math.random().toString(16).substring(2),
            proj: {
                id: this.selectedPROJ._id,
                name: this.selectedPROJ.title
            },
            owner: this.selectedPROJ.owner
        };
        if (this.selectedPROJ.team) {
            newEnv.team = this.selectedPROJ.team;
        }

        (async () => {
            var settingEnvVals = [{
                key: 'host',
                val: settings.host,
                readOnly: true
            }, {
                key: 'basePath',
                val: settings.basePath,
                readOnly: true
            }, {
                key: 'scheme',
                val: settings.protocol + '://',
                readOnly: true
            }];

            if (action === 'add') {
                newEnv.vals = settingEnvVals;
                return this.envService.addEnv(newEnv);
            } else {
                //TODO: probably handled via state update 
                //if update get existing values and update

                // console.log(fn)
                // var envToUpdate: Env = fn(this.selectedPROJ.setting.envId)
                var vals = this.projEnv.vals;
                var rest = vals.filter(function (val) {
                    return ['host', 'basePath', 'scheme'].indexOf(val.key) < 0
                });
                newEnv.vals = [...settingEnvVals, ...rest];

                // for (var i = 0; i < $rootScope.ENVS.length; i++) {
                //     if ($rootScope.ENVS[i]._id === this.selectedPROJ.setting.envId) {
                //         var vals = $rootScope.ENVS[i].vals;
                //         var rest = vals.filter(function (val) {
                //             return ['host', 'basePath', 'scheme'].indexOf(val.key) < 0
                //         });
                //         newEnv.vals = settingEnvVals.concat(rest);
                //         break;
                //     }
                // }
                return this.envService.updateEnv(newEnv);
            }

        })().then(() => {
            var prevSetting = Utils.deepCopy(this.selectedPROJ.setting);
            this.selectedPROJ.setting = {
                host: settings.host,
                basePath: settings.basePath,
                protocol: settings.protocol,
                envId: newEnv._id
            };
            this.updateApiProject(this.selectedPROJ).then(() => {
                this.store.select(EnvState.getById).pipe(map(filterFn => filterFn(this.selectedPROJ.setting.envId)))
                    .subscribe(env => { this.projEnv = env });
                this.toaster.success('Settings Saved');
            }, (e) => {
                console.log(e);
                this.toaster.error(`Failed to save setting: ${e.message}`);
                this.selectedPROJ.setting = prevSetting;
            });
        }, (e) => {
            console.log(e);
            this.toaster.error(`Failed to save setting: ${e.message}`);
        });
    }

    saveProjEdit() {
        if (!this.projDetailForm.valid) return;
        const formValue = this.projDetailForm.value;
        let envUpdateRequired = false;

        if (this.selectedPROJ.title !== formValue.title && this.selectedPROJ.setting) envUpdateRequired = true;
        this.selectedPROJ.title = formValue.title;
        this.selectedPROJ.version = formValue.version;
        this.selectedPROJ.description = formValue.description;
        this.selectedPROJ.termsOfService = formValue.termsOfService;
        if (formValue.license) {
            if (!this.selectedPROJ.license) {
                this.selectedPROJ.license = {};
            }
            this.selectedPROJ.license.name = formValue.license.name;
            this.selectedPROJ.license.url = formValue.license.url;

        }
        if (formValue.contact) {
            if (!this.selectedPROJ.contact) {
                this.selectedPROJ.contact = {};
            }
            this.selectedPROJ.contact.url = formValue.contact.url;
            this.selectedPROJ.contact.email = formValue.contact.email;
            this.selectedPROJ.contact.name = formValue.contact.name;
        }

        this.updateApiProject(this.selectedPROJ).then(() => {
            this.resetProjInfoEdit();
            this.toaster.success('Project details updated');
            if (envUpdateRequired) {
                this.projEnv.name = this.selectedPROJ.title + '-env';
                this.projEnv.proj.name = this.selectedPROJ.title;
                this.envService.updateEnv(this.projEnv);
            }
        });
    }




    changeStage(name) {
        this.changeStageEmitter.emit(name);
    }

    resetProjInfoEdit() {
        this.flags.editProj = false;
        this.projDetailForm.patchValue({
            title: this.selectedPROJ.title,
            version: this.selectedPROJ.version,
            description: this.selectedPROJ.description,
            termsOfService: this.selectedPROJ.termsOfService,
            license: {
                name: this.selectedPROJ.license ? this.selectedPROJ.license.name : '',
                url: this.selectedPROJ.license ? this.selectedPROJ.license.url : ''
            },
            contact: {
                name: this.selectedPROJ.contact ? this.selectedPROJ.contact.name : '',
                url: this.selectedPROJ.contact ? this.selectedPROJ.contact.url : '',
                email: this.selectedPROJ.contact ? this.selectedPROJ.contact.email : ''
            }
        });
    }



    ngOnInit(): void {
        this.selectProject();
    }

}
